import type { App } from "obsidian";
import { Component, MarkdownRenderer, Modal, requestUrl } from "obsidian";
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

	const releases: Release[] | { message: string } = response.json;

	if ((response.status >= 400 && "message" in releases) || !Array.isArray(releases)) {
		throw new Error(
			`Failed to fetch releases: ${releases.message ?? "Unknown error"}`
		);
	}

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

	const result: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();

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
	}

	onClose() {
		const { contentEl } = this;
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

		void MarkdownRenderer.render(
			this.app,
			markdownStr,
			contentDiv,
			this.app.vault.getRoot().path,
			new Component(),
		);
	}
}
