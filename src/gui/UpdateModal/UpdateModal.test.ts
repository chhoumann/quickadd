import { describe, expect, it } from "vitest";
import { renderVideoAttachments } from "./UpdateModal";

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

	it("handles empty bodies", () => {
		expect(renderVideoAttachments("")).toBe("");
	});

	it("leaves bodies without video attachments untouched", () => {
		const body = "## Features\n\n- something new\n";
		expect(renderVideoAttachments(body)).toBe(body);
	});
});
