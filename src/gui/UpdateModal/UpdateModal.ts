import type { App } from "obsidian";
import {
	ButtonComponent,
	Component,
	MarkdownRenderer,
	Modal,
	requestUrl,
} from "obsidian";
import { log } from "src/logger/logManager";

type Release = {
	tag_name: string;
	// The GitHub API allows a null release body.
	body: string | null;
	draft: boolean;
	prerelease: boolean;
};

/**
 * Fetches the releases for a repository on GitHub and returns the release notes for every release
 * that comes after a specific release.
 *
 * @param repoOwner The owner of the repository.
 * @param repoName The name of the repository.
 * @param releaseTagName The tag name of the release to start getting release notes from.
 * @returns An array of Release objects, each containing the tag name and release notes for a single release.
 * @throws An error if there was an error fetching the releases or if the release with the specified tag name
 *         could not be found.
 */
export async function getReleaseNotesAfter(
	repoOwner: string,
	repoName: string,
	releaseTagName: string
): Promise<Release[]> {
	const response = await requestUrl({
		url: `https://api.github.com/repos/${repoOwner}/${repoName}/releases`,
		throw: false,
	});

	const body: unknown = response.json;

	if (!Array.isArray(body)) {
		// A non-array body means there are no releases to page through: GitHub's
		// error shape is `{ message }`, but an intermediary can also return a
		// literal `null`/primitive. Read `.message` only when it's actually a
		// string, so a null/primitive body degrades to "Unknown error" instead of
		// throwing a TypeError (`null.message` / `"message" in null`) that would
		// mask the real failure.
		const message =
			typeof body === "object" &&
			body !== null &&
			"message" in body &&
			typeof (body as { message?: unknown }).message === "string"
				? (body as { message: string }).message
				: "Unknown error";
		throw new Error(`Failed to fetch releases: ${message}`);
	}

	const releases = body as Release[];

	const startReleaseIdx = releases.findIndex(
		(release) => release.tag_name === releaseTagName
	);

	if (startReleaseIdx === -1) {
		throw new Error(`Could not find release with tag ${releaseTagName}`);
	}

	return releases
		.slice(0, startReleaseIdx)
		.filter((release) => !release.draft && !release.prerelease);
}

const USER_ATTACHMENT_VIDEO_URL =
	/^https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+$/;
// A linked thumbnail: [![alt](poster.png)](https://github.com/user-attachments/assets/...)
const LINKED_VIDEO_THUMBNAIL =
	/^\[!\[[^\]]*\]\(([^)\s"]+)\)\]\((https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+)\)$/;
// A poster hint next to a bare video URL: <!-- poster: https://... -->
// GitHub strips HTML comments, so release notes can carry a poster for the
// modal's player without rendering a duplicate video on the GitHub page
// (GitHub also turns links to video attachments into players).
const VIDEO_POSTER_COMMENT = /^<!--\s*poster:\s*(https:\/\/[^\s"'>]+)\s*-->$/;

function videoPlayerHtml(url: string, poster?: string): string {
	const posterAttr = poster ? ` poster="${poster}"` : "";
	return `<video controls preload="metadata" playsinline style="width: 100%; border-radius: 8px;" src="${url}"${posterAttr}></video>`;
}

/**
 * GitHub renders a bare user-attachments URL on its own line as an inline
 * video player, but Obsidian's markdown renderer would show it as a raw
 * link. Obsidian can play these URLs natively, so replace the bare line
 * with a real <video> player. A thumbnail image linking to the same video
 * (the GitHub-page fallback) becomes the player's poster instead of a
 * duplicate visual.
 */
export function renderVideoAttachments(markdownText: string): string {
	const lines = markdownText.split("\n");

	const bareUrls = new Set<string>();
	for (const line of lines) {
		const trimmed = line.trim();
		if (USER_ATTACHMENT_VIDEO_URL.test(trimmed)) bareUrls.add(trimmed);
	}

	const posters = new Map<string, string>();
	for (const line of lines) {
		const thumbnail = line.trim().match(LINKED_VIDEO_THUMBNAIL);
		if (thumbnail && bareUrls.has(thumbnail[2])) {
			posters.set(thumbnail[2], thumbnail[1]);
		}
	}

	// A poster comment adjacent to a bare URL (above or below, across blank
	// lines) wins over a thumbnail-derived poster.
	const consumedPosterLines = new Set<number>();
	for (let i = 0; i < lines.length; i++) {
		if (!USER_ATTACHMENT_VIDEO_URL.test(lines[i].trim())) continue;
		for (const direction of [1, -1]) {
			let j = i + direction;
			while (j >= 0 && j < lines.length && lines[j].trim() === "") {
				j += direction;
			}
			const comment =
				j >= 0 && j < lines.length
					? lines[j].trim().match(VIDEO_POSTER_COMMENT)
					: null;
			if (comment) {
				posters.set(lines[i].trim(), comment[1]);
				consumedPosterLines.add(j);
				break;
			}
		}
	}

	const result: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		if (consumedPosterLines.has(i)) continue;

		const thumbnail = trimmed.match(LINKED_VIDEO_THUMBNAIL);
		if (thumbnail && bareUrls.has(thumbnail[2])) continue;

		if (USER_ATTACHMENT_VIDEO_URL.test(trimmed)) {
			result.push(videoPlayerHtml(trimmed, posters.get(trimmed)));
			continue;
		}

		result.push(line);
	}

	return result.join("\n");
}

function addExtraHashToHeadings(
	markdownText: string,
	numHashes = 1
): string {
	// Split the markdown text into an array of lines
	const lines = markdownText.split("\n");

	// Loop through each line and check if it starts with a heading syntax (#)
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].startsWith("#")) {
			// If the line starts with a heading syntax, add an extra '#' to the beginning
			lines[i] = "#".repeat(numHashes) + lines[i];
		}
	}

	// Join the array of lines back into a single string and return it
	return lines.join("\n");
}

export class UpdateModal extends Modal {
	releases: Release[];
	private releaseNotesPromise: Promise<Release[]>;
	private previousVersion: string;
	// Owns the lifecycle of the markdown render's child components so they are
	// torn down on close, rather than leaking onto a longer-lived owner.
	private readonly markdownComponent = new Component();
	// The release-notes fetch can resolve after the user has already dismissed the
	// modal (the in-content Done button makes closing-while-fetching easy). Without
	// this guard, the late display() would re-load markdownComponent (already
	// unloaded in onClose) and render into a detached contentEl.
	private isClosed = false;

	constructor(app: App, previousQAVersion: string) {
		super(app);
		this.previousVersion = previousQAVersion;

		this.releaseNotesPromise = getReleaseNotesAfter(
			"chhoumann",
			"quickadd",
			previousQAVersion
		);
		this.releaseNotesPromise
			.then((releases) => {
				if (this.isClosed) return;

				this.releases = releases;

                if (this.releases.length === 0) {
                    this.close();
                    return;
                }

				this.display();
			})
			.catch((err) => {
				log.logError(`Failed to fetch release notes: ${err as string}`);
			});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h1", {
			text: "Fetching release notes...",
		});
		// Always offer a reachable exit, even while fetching or if the fetch fails.
		this.addCloseFooter();
	}

	/**
	 * A self-owned dismiss control. On phones the system close (X) sits in the top
	 * safe-area zone (status bar / Dynamic Island) where it can be untappable, and
	 * this modal has no other exit (no Esc key, no backdrop to tap) — so it must
	 * always offer a reachable Close. The footer follows the (internally scrollable)
	 * release notes in normal flow so it stays visible, and clears the bottom
	 * home-indicator inset on mobile (#635).
	 */
	private addCloseFooter(): void {
		const footer = this.contentEl.createDiv("quickadd-update-modal-footer");
		new ButtonComponent(footer)
			.setButtonText("Done")
			.setCta()
			.onClick(() => this.close());
	}

	onClose() {
		const { contentEl } = this;
		this.isClosed = true;
		this.markdownComponent.unload();
		contentEl.empty();
	}

	private display(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.classList.add("quickadd-update-modal-container");

        const header = `### New in QuickAdd v${this.releases[0].tag_name}\n`
		const text = `Thank you for using QuickAdd! If you like the plugin, please consider supporting me by buying me a coffee. With your sponsorship, I'll be able to contribute more to my existing projects, start new ones, and be more responsive to issues & feature requests.`;
		const buymeacoffee = `<div class="quickadd-bmac-container"><a href="https://www.buymeacoffee.com/chhoumann" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 40px !important;width: 144px !important;" ></a></div>`;

		const contentDiv = contentEl.createDiv("quickadd-update-modal");
		const releaseNotes = this.releases
			.map((release) => renderVideoAttachments(release.body ?? ""))
			.join("\n---\n");

		const andNow = `And now, here is everything new in QuickAdd since your last update (v${this.previousVersion}):`;
        const feedbackForm = `I'd love to get your feedback on QuickAdd! Please fill out this <a href="https://forms.gle/WRq1ewcKK8qmkqps6">feedback form</a> to let me know what you think.`;
		const markdownStr = `${header}\n${text}\n${buymeacoffee}\n${feedbackForm}\n\n${andNow}\n\n---\n\n${addExtraHashToHeadings(
			releaseNotes
		)}`;

		this.markdownComponent.load();
		void MarkdownRenderer.render(
			this.app,
			markdownStr,
			contentDiv,
			this.app.vault.getRoot().path,
			this.markdownComponent,
		);

		this.addCloseFooter();
	}
}
