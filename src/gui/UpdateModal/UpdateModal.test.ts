import { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	getReleaseNotesAfter,
	renderVideoAttachments,
	UpdateModal,
} from "./UpdateModal";

const requestUrlMock = vi.hoisted(() => vi.fn());

// Keep the obsidian stub (Modal, Component, MarkdownRenderer, ...) intact - only
// override requestUrl so getReleaseNotesAfter can be driven with crafted bodies.
vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, requestUrl: requestUrlMock };
});

function mockResponse(status: number, json: unknown): void {
	requestUrlMock.mockResolvedValue({
		status,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		json,
		text: typeof json === "string" ? json : JSON.stringify(json),
	});
}

const VIDEO_URL =
	"https://github.com/user-attachments/assets/27712a0b-a26d-4a69-ac21-a7b4af6c5616";
const THUMB_URL = "https://example.com/video-thumb.png";

describe("renderVideoAttachments", () => {
	it("replaces a bare video URL with an inline <video> player", () => {
		const body = ["Intro text.", "", VIDEO_URL, "", "More text."].join("\n");

		const result = renderVideoAttachments(body);

		expect(result).toContain(`<video controls`);
		expect(result).toContain(`src="${VIDEO_URL}"`);
		expect(result).not.toMatch(new RegExp(`^${VIDEO_URL}$`, "m"));
	});

	it("folds a thumbnail linking to the same video into the player's poster", () => {
		const body = [
			"🎬 **A 60-second tour of the highlights:**",
			"",
			`[![Watch the release video](${THUMB_URL})](${VIDEO_URL})`,
			"",
			VIDEO_URL,
			"",
			"## Next section",
		].join("\n");

		const result = renderVideoAttachments(body);

		const players = result.match(/<video /g) ?? [];
		expect(players).toHaveLength(1);
		expect(result).toContain(`poster="${THUMB_URL}"`);
		expect(result).not.toContain("[![");
		expect(result).toContain("## Next section");
	});

	it("keeps a linked thumbnail that has no matching bare URL", () => {
		const body = `[![Watch](${THUMB_URL})](${VIDEO_URL.replace("27712a0b", "deadbeef")})`;

		const result = renderVideoAttachments(body);

		expect(result).toBe(body);
	});

	it("handles indented bare URLs and ignores non-attachment URLs", () => {
		const body = [
			`  ${VIDEO_URL}`,
			"https://github.com/chhoumann/quickadd/releases/download/2.13.0/video.mp4",
			"https://example.com/page",
		].join("\n");

		const result = renderVideoAttachments(body);

		expect(result).toContain(`src="${VIDEO_URL}"`);
		expect(result).toContain(
			"https://github.com/chhoumann/quickadd/releases/download/2.13.0/video.mp4"
		);
		expect(result).toContain("https://example.com/page");
	});

	it("renders a player for every occurrence of a repeated bare URL", () => {
		const body = ["Intro.", "", VIDEO_URL, "", "Recap:", "", VIDEO_URL].join(
			"\n"
		);

		const result = renderVideoAttachments(body);

		const players = result.match(/<video /g) ?? [];
		expect(players).toHaveLength(2);
		expect(result).not.toMatch(new RegExp(`^${VIDEO_URL}$`, "m"));
	});

	it("uses an adjacent poster comment and removes it from the output", () => {
		const body = [
			"🎬 **A 60-second tour of the highlights:**",
			"",
			VIDEO_URL,
			`<!-- poster: ${THUMB_URL} -->`,
			"",
			"## Next section",
		].join("\n");

		const result = renderVideoAttachments(body);

		expect(result).toContain(`poster="${THUMB_URL}"`);
		expect(result).not.toContain("<!-- poster:");
		expect(result).toContain("## Next section");
	});

	it("prefers the poster comment over a thumbnail-derived poster", () => {
		const otherPoster = "https://example.com/other.png";
		const body = [
			`[![Watch](${THUMB_URL})](${VIDEO_URL})`,
			"",
			VIDEO_URL,
			"",
			`<!-- poster: ${otherPoster} -->`,
		].join("\n");

		const result = renderVideoAttachments(body);

		expect(result).toContain(`poster="${otherPoster}"`);
		expect((result.match(/<video /g) ?? []).length).toBe(1);
	});

	it("leaves poster comments without an adjacent video URL untouched", () => {
		const body = `Some text.\n<!-- poster: ${THUMB_URL} -->\nMore text.`;
		expect(renderVideoAttachments(body)).toBe(body);
	});

	it("handles empty bodies", () => {
		expect(renderVideoAttachments("")).toBe("");
	});

	it("leaves bodies without video attachments untouched", () => {
		const body = "## Features\n\n- something new\n";
		expect(renderVideoAttachments(body)).toBe(body);
	});
});

describe("getReleaseNotesAfter", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
	});

	it("degrades to 'Unknown error' when the body is a literal null (status 200)", async () => {
		mockResponse(200, null);
		// Before the guard this threw `Cannot read properties of null (reading
		// 'message')`, masking the real failure; now it is a clean message.
		await expect(getReleaseNotesAfter("chhoumann", "quickadd", "1.0.0")).rejects.toThrow(
			"Failed to fetch releases: Unknown error",
		);
	});

	it("degrades to 'Unknown error' when an error body is null (status 500)", async () => {
		mockResponse(500, null);
		await expect(getReleaseNotesAfter("chhoumann", "quickadd", "1.0.0")).rejects.toThrow(
			"Failed to fetch releases: Unknown error",
		);
	});

	it("surfaces GitHub's error message for a non-array body", async () => {
		mockResponse(403, { message: "API rate limit exceeded" });
		await expect(getReleaseNotesAfter("chhoumann", "quickadd", "1.0.0")).rejects.toThrow(
			"Failed to fetch releases: API rate limit exceeded",
		);
	});

	it("degrades to 'Unknown error' for a non-array body with a non-string message", async () => {
		mockResponse(500, { message: 42 });
		await expect(getReleaseNotesAfter("chhoumann", "quickadd", "1.0.0")).rejects.toThrow(
			"Failed to fetch releases: Unknown error",
		);
	});

	it("rejects an error status even when the body is an array (no bogus release notes)", async () => {
		// An intermediary could pair a 5xx with a stale array body; an error status
		// must be a failure regardless of body shape, never surfaced as releases.
		mockResponse(503, [
			{ tag_name: "9.9.9", body: "stale", draft: false, prerelease: false },
		]);
		await expect(getReleaseNotesAfter("chhoumann", "quickadd", "1.0.0")).rejects.toThrow(
			"Failed to fetch releases: Unknown error",
		);
	});

	it("returns every stable release newer than a version missing from the list", async () => {
		// A user upgrading from a version older than the fetched page (e.g. 1.18.1)
		// must still get notes, not a "could not find release" failure.
		const release = (tag_name: string, extra = {}) => ({
			tag_name,
			body: tag_name,
			draft: false,
			prerelease: false,
			...extra,
		});
		mockResponse(200, [
			release("2.10.0"),
			release("2.9.5", { prerelease: true }),
			release("2.9.4", { draft: true }),
			release("2.9.0"),
			release("not-a-version"),
			release("1.18.0"),
		]);

		const releases = await getReleaseNotesAfter("chhoumann", "quickadd", "1.18.1");

		expect(releases.map((r) => r.tag_name)).toEqual(["2.10.0", "2.9.0"]);
	});

	it("compares versions numerically, not as strings", async () => {
		mockResponse(200, [
			{ tag_name: "2.10.0", body: "", draft: false, prerelease: false },
			{ tag_name: "2.9.0", body: "", draft: false, prerelease: false },
		]);

		const releases = await getReleaseNotesAfter("chhoumann", "quickadd", "2.9.0");

		expect(releases.map((r) => r.tag_name)).toEqual(["2.10.0"]);
	});

	it("rejects a previous version that is not valid semver", async () => {
		mockResponse(200, [{ tag_name: "9.9.9", body: "", draft: false, prerelease: false }]);
		await expect(getReleaseNotesAfter("chhoumann", "quickadd", "garbage")).rejects.toThrow(
			"Invalid version garbage",
		);
	});
});

describe("UpdateModal", () => {
	beforeEach(() => {
		requestUrlMock.mockReset();
	});

	it("closes instead of staying on the loading state when the fetch fails", async () => {
		mockResponse(403, { message: "API rate limit exceeded" });

		const modal = new UpdateModal(new App() as never, "2.0.0");
		modal.open();
		expect(modal.contentEl.textContent).toContain("Fetching release notes...");

		await vi.waitFor(() => expect(modal.containerEl.isConnected).toBe(false));
	});
});
