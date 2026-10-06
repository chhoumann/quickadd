import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// #2062: a note is found by its aliases in the {{FILE:}} picker, the one-page
// form's file field and the Capture to picker, shown like the quick switcher
// shows an alias, and picking that row uses the note.
const getContext = createQuickAddE2EHarness("file-picker-aliases");

type Row = { title: string; note: string; alias: boolean };

it("finds notes by alias in the file pickers and uses the note", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const thomas = await seedVaultFile(obsidian, sandbox, "People/Thomas Anderson.md",
		"---\naliases: [Neo, The One]\n---\n");
	await seedVaultFile(obsidian, sandbox, "People/Neo Classic.md", "plain\n");
	const people = sandbox.path("People");
	const out = sandbox.path("Out.md");

	const capture = (name: string, captureTo: string, format: string) => {
		const choice = new CaptureChoice(name);
		choice.command = true;
		choice.captureTo = captureTo;
		choice.onePageInput = "never";
		choice.createFileIfItDoesntExist = { ...choice.createFileIfItDoesntExist, enabled: true };
		choice.format = { enabled: true, format };
		return choice;
	};
	const filePick = capture("Alias file pick", out, `{{FILE:${people}}}\n`);
	const onePage = capture("Alias one page", out, `{{FILE:${people}|label:Person}}\n`);
	onePage.onePageInput = "always";
	const target = capture("Alias capture target", `${people}/`, "- captured\n");
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [filePick, onePage, target];
	}));
	await plugin.reload({ waitUntilReady: true });

	const rows = (selector: string) => obsidian.dev.evalJson<Row[]>(`
		Array.from(document.querySelectorAll(${jsLiteral(selector)})).map((row) => ({
			title: row.querySelector(".suggestion-title, .qa-onepage-file-suggestion__label")?.textContent ?? row.textContent,
			note: row.querySelector(".suggestion-note, .qa-onepage-file-suggestion__path")?.textContent ?? "",
			alias: Boolean(row.querySelector('[aria-label="Alias"]')),
		}))
	`);
	const read = (path: string) => obsidian.dev.evalJsonAsync<string | null>(
		`(async () => (await app.vault.adapter.exists(${jsLiteral(path)})) ? app.vault.adapter.read(${jsLiteral(path)}) : null)()`,
	);
	const prompt = ".prompt .prompt-input";
	const promptRows = ".prompt .suggestion-item";

	// {{FILE:}}: the alias row names the note beneath it and inserts the note.
	await obsidian.command(`quickadd:choice:${filePick.id}`).run();
	await expect.poll(() => obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(${jsLiteral(prompt)}))`), POLL_OPTS).toBe(true);
	await typeInto(obsidian, prompt, "neo");
	await expect.poll(() => rows(promptRows), POLL_OPTS).toEqual([
		{ title: "Neo", note: "Thomas Anderson", alias: true },
		{ title: "Neo Classic", note: "", alias: false },
	]);
	await pressKey(obsidian, "Enter");
	await expect.poll(() => read(out), POLL_OPTS).toBe("Thomas Anderson\n");

	// One-page form: the same in its inline file field.
	const field = ".qa-onepage-file-picker input";
	await obsidian.command(`quickadd:choice:${onePage.id}`).run();
	await expect.poll(() => obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(${jsLiteral(field)}))`), POLL_OPTS).toBe(true);
	await typeInto(obsidian, field, "the one");
	await expect.poll(() => rows(".suggestion-container .suggestion-item"), POLL_OPTS).toEqual([
		{ title: "The One", note: "Thomas Anderson", alias: true },
	]);
	await pressKey(obsidian, "Enter");
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const submit = Array.from(document.querySelectorAll(".modal-container button")).find((b) => b.textContent.trim() === "Submit");
		submit?.click();
		return Boolean(submit);
	})()`)).toBe(true);
	await expect.poll(() => read(out), POLL_OPTS).toBe("Thomas Anderson\nThomas Anderson\n");

	// Capture to a folder: typing an alias picks its note, and Enter doesn't
	// create a new note named after the alias.
	await obsidian.command(`quickadd:choice:${target.id}`).run();
	await expect.poll(() => obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(${jsLiteral(prompt)}))`), POLL_OPTS).toBe(true);
	await typeInto(obsidian, prompt, "Neo");
	await expect.poll(async () => (await rows(promptRows))[0], POLL_OPTS)
		.toEqual({ title: "Neo", note: "Thomas Anderson", alias: true });
	// Every row bolds the match, as the quick switcher does, not just alias rows.
	expect(await obsidian.dev.evalJson<string[]>(`
		Array.from(document.querySelectorAll(${jsLiteral(promptRows)}), (row) =>
			Array.from(row.querySelectorAll(".suggestion-highlight"), (span) => span.textContent).join("|"))
	`)).toEqual(["Neo", "Neo"]);
	await pressKey(obsidian, "Enter");
	await expect.poll(() => read(thomas), POLL_OPTS).toContain("- captured");
	expect(await read(`${people}/Neo.md`)).toBeNull();
});
