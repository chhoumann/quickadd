import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, TFile } from "obsidian";
import { testApp } from "../../../tests/helpers/settings/modalApp";
import InputSuggester from "../InputSuggester/inputSuggester";
import { promptCancelled } from "../../errors/UserCancelError";
import { pickUserScript } from "./pickUserScript";

const notices = (Notice as unknown as { instances: Array<{ message: string; messageEl: HTMLElement }> }).instances;

function file(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split("/").pop()!;
	f.extension = f.name.split(".").pop()!;
	f.basename = f.name.slice(0, -(f.extension.length + 1));
	return f;
}

function appWith(files: TFile[], noteContent = "") {
	const app = testApp();
	app.vault.getFiles = () => files;
	app.vault.read = async () => noteContent;
	// Notes are candidates only when the cache says they hold a code block.
	app.metadataCache.getFileCache = () => ({
		sections: [{ type: "code", position: {} }],
	}) as never;
	return app;
}

describe("pickUserScript", () => {
	beforeEach(() => {
		notices.length = 0;
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns the picked script's label and path", async () => {
		const app = appWith([file("scripts/hello.js"), file("scripts/other.js")]);
		const suggest = vi.spyOn(InputSuggester, "Suggest").mockResolvedValue("scripts/hello.js");

		await expect(pickUserScript(app)).resolves.toEqual({
			name: "hello",
			path: "scripts/hello.js",
		});
		expect(suggest.mock.calls[0][2]).toEqual(["scripts/hello.js", "scripts/other.js"]);
	});

	it("returns null and says why when the vault has no scripts", async () => {
		const suggest = vi.spyOn(InputSuggester, "Suggest");

		await expect(pickUserScript(appWith([]))).resolves.toBeNull();
		expect(suggest).not.toHaveBeenCalled();
		expect(notices.map((n) => n.messageEl.textContent)).toEqual([
			expect.stringContaining("No scripts found"),
		]);
	});

	it("returns null when the user dismisses the picker", async () => {
		vi.spyOn(InputSuggester, "Suggest").mockRejectedValue(promptCancelled());

		await expect(pickUserScript(appWith([file("scripts/hello.js")]))).resolves.toBeNull();
	});

	it("refuses a note whose js block cannot run", async () => {
		const app = appWith([file("Notes/Script note.md")], "```python\nprint(1)\n```\n");
		vi.spyOn(InputSuggester, "Suggest").mockResolvedValue("Notes/Script note.md");

		await expect(pickUserScript(app)).resolves.toBeNull();
		expect(notices.map((n) => n.message)).toEqual([
			expect.stringContaining('"Notes/Script note.md" - '),
		]);
	});

	it("takes a note with a runnable js block", async () => {
		const app = appWith([file("Notes/Script note.md")], "```js\nmodule.exports = () => {};\n```\n");
		vi.spyOn(InputSuggester, "Suggest").mockResolvedValue("Notes/Script note.md");

		await expect(pickUserScript(app)).resolves.toEqual({
			name: "Notes/Script note.md",
			path: "Notes/Script note.md",
		});
	});
});
