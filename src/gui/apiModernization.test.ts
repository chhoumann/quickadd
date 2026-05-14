import { describe, expect, it, vi } from "vitest";
import { App, Notice } from "obsidian";
import * as obsidian from "obsidian";
import { getReleaseNotesAfter } from "./UpdateModal/UpdateModal";
import { showNoScriptsFoundNotice } from "./MacroGUIs/noScriptsFoundNotice";

describe("API modernization", () => {
	it("uses requestUrl for release notes and preserves filtering semantics", async () => {
		const requestUrlSpy = vi.spyOn(obsidian, "requestUrl").mockResolvedValue({
			status: 200,
			headers: {},
			arrayBuffer: new ArrayBuffer(0),
			text: "",
			json: [
				{
					tag_name: "2.2.0",
					body: "new stable",
					draft: false,
					prerelease: false,
				},
				{
					tag_name: "2.1.0",
					body: "draft skipped",
					draft: true,
					prerelease: false,
				},
				{
					tag_name: "2.0.0",
					body: "current",
					draft: false,
					prerelease: false,
				},
			],
		});

		await expect(
			getReleaseNotesAfter("owner", "repo", "2.0.0"),
		).resolves.toEqual([
			{
				tag_name: "2.2.0",
				body: "new stable",
				draft: false,
				prerelease: false,
			},
		]);
		expect(requestUrlSpy).toHaveBeenCalledWith({
			url: "https://api.github.com/repos/owner/repo/releases",
			throw: false,
		});

		requestUrlSpy.mockRestore();
	});

	it("renders no-script notices through messageEl and Vault configDir", () => {
		const app = new App();
		app.vault.configDir = ".custom-obsidian";

		showNoScriptsFoundNotice(app);

		const notice = (
			Notice as unknown as {
				instances: Array<{ message: string; timeout?: number; messageEl: HTMLElement }>;
			}
		).instances.at(-1);
		expect(notice).toMatchObject({ message: "", timeout: 10000 });
		const noticeEl = notice?.messageEl;

		expect(noticeEl?.textContent).toContain("No JavaScript files found");
		expect(noticeEl?.textContent).toContain(
			"✓ In your vault (not in .custom-obsidian folder)",
		);
	});

	it("slice replacements preserve prior substr behavior for suggester edits", () => {
		const input = "prefix [[Current#Heading]] suffix";
		const cursorPosition = "prefix [[Current#Heading".length;
		const lastInputLength = "Current#Heading".length;
		const selectedItem = "[[Target#Heading]]";

		const previousLinkValue = `${input.substring(
			0,
			cursorPosition - lastInputLength - 2,
		)}${selectedItem}${input.substring(cursorPosition)}`;
		const modernLinkValue = `${input.slice(
			0,
			cursorPosition - lastInputLength - 2,
		)}${selectedItem}${input.slice(cursorPosition)}`;

		expect(modernLinkValue).toBe(previousLinkValue);
		expect("abcdef".slice(0, 0)).toBe("");
		expect("abcdef".slice(3)).toBe("def");
	});
});
