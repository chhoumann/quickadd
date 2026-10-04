import { afterEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

const getContext = createQuickAddE2EHarness("capture-user-text");

// Executing this fence would set the flag and write SCRIPT-RAN.
const FENCE = "```js quickadd\nwindow.__qaUserTextFenceRan = true;\nreturn 'SCRIPT-RAN';\n```";
const USER_TEXT = `clipped from a web page:\n${FENCE}\n{{DATE:YYYY}}`;

async function setup(format: string, configure?: (choice: CaptureChoice) => void) {
	const { obsidian, sandbox } = getContext();
	const choice = new CaptureChoice("Capture user text");
	choice.command = true;
	choice.onePageInput = "never";
	choice.captureTo = await seedVaultFile(obsidian, sandbox, `inbox-${choice.id}.md`, "# Inbox\n## Log\n");
	choice.format = { enabled: true, format };
	choice.prepend = true;
	configure?.(choice);
	await save(choice);
	return choice;
}

async function save(choice: IChoice) {
	const { plugin } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices(data => { data.choices.push(choice); }));
	await plugin.reload({ waitUntilReady: true });
}

async function selectAll(path: string) {
	await getContext().obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)}), { state: { mode: "source" } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		const editor = leaf.view.editor;
		editor.focus();
		editor.setSelection({ line: 0, ch: 0 }, { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length });
		return editor.getSelection().length > 0;
	})()`);
}

async function openLink(choice: IChoice, value: string) {
	// The renderer entry point Obsidian calls for an opened obsidian:// URL.
	await getContext().obsidian.dev.evalJson(`(() => {
		window.OBS_ACT({ action: "quickadd", choice: ${JSON.stringify(choice.name)}, "value-value": ${JSON.stringify(value)} });
		return true;
	})()`);
}

async function read(path: string) {
	return getContext().obsidian.dev.evalJsonAsync<string | null>(`(async () => {
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(path)});
		return file ? app.vault.read(file) : null;
	})()`);
}

async function captured(path: string) {
	return getContext().obsidian.dev.evalJsonAsync<string>(`(async () =>
		app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))
	)()`);
}

async function fenceRan() {
	return getContext().obsidian.dev.evalJson<boolean>("window.__qaUserTextFenceRan === true");
}

describe("Capture writes user-supplied text verbatim in native Obsidian", () => {
	afterEach(async () => {
		await getContext().obsidian.dev.evalJson("(() => { delete window.__qaUserTextFenceRan; return true; })()");
	});

	it("captures a selected fence as text when run from the choice's command", async () => {
		const { obsidian, sandbox } = getContext();
		const choice = await setup("{{SELECTED}}");
		const source = await seedVaultFile(obsidian, sandbox, `source-${choice.id}.md`, USER_TEXT);
		await obsidian.dev.evalJsonAsync(`(async () => {
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(source)}), { state: { mode: "source" } });
			app.workspace.setActiveLeaf(leaf, { focus: true });
			const editor = leaf.view.editor;
			editor.focus();
			editor.setSelection({ line: 0, ch: 0 }, { line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length });
			return editor.getSelection().length > 0;
		})()`);

		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		await expect.poll(() => captured(choice.captureTo), POLL_OPTS).not.toBe("# Inbox\n## Log\n");
		expect(await captured(choice.captureTo)).toBe(`# Inbox\n## Log\n${USER_TEXT}`);
		expect(await fenceRan()).toBe(false);
	});

	it("captures a value passed in an obsidian:// link as text", async () => {
		const { obsidian } = getContext();
		const choice = await setup("{{VALUE}}");

		// The renderer entry point Obsidian calls for an opened obsidian:// URL.
		await obsidian.dev.evalJson(`(() => {
			window.OBS_ACT({ action: "quickadd", choice: ${JSON.stringify(choice.name)}, "value-value": ${JSON.stringify(USER_TEXT)} });
			return true;
		})()`);

		await expect.poll(() => captured(choice.captureTo), POLL_OPTS).not.toBe("# Inbox\n## Log\n");
		expect(await captured(choice.captureTo)).toBe(`# Inbox\n## Log\n${USER_TEXT}`);
		expect(await fenceRan()).toBe(false);
	});

	it("captures tokens in a selection as text", async () => {
		const { obsidian, sandbox } = getContext();
		const choice = await setup("{{SELECTED}} {{TITLE}}");
		const text = "<title>{{title}}</title> {{RANDOM:4}} {{FIELD:status}} {{CURSOR}}";
		await selectAll(await seedVaultFile(obsidian, sandbox, `source-${choice.id}.md`, text));

		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		await expect.poll(() => captured(choice.captureTo), POLL_OPTS).not.toBe("# Inbox\n## Log\n");
		expect(await captured(choice.captureTo)).toBe(`# Inbox\n## Log\n${text} inbox-${choice.id}`);
	});

	it("creates a Template note with tokens in a link value as text", async () => {
		const { obsidian, sandbox } = getContext();
		const choice = new TemplateChoice("Template user text");
		choice.onePageInput = "never";
		choice.templatePath = await seedVaultFile(obsidian, sandbox, `template-${choice.id}.md`, "{{VALUE}} {{TITLE}}");
		const path = sandbox.path(`note-${choice.id}.md`);
		choice.fileNameFormat = { enabled: true, format: path.slice(0, -3) };
		await save(choice);

		await openLink(choice, "{{title}} {{RANDOM:4}} {{CURSOR}}");

		await expect.poll(() => read(path), POLL_OPTS).toBe(`{{title}} {{RANDOM:4}} {{CURSOR}} note-${choice.id}`);
	});
});

describe.runIf(process.env.OBSIDIAN_E2E_TEMPLATER === "1")("User text with real Templater", () => {
	// Running this tag would set the flag and write TP-RAN.
	const TAG = "<%* window.__qaUserTextTemplaterRan = true; tR += 'TP-RAN' %>";

	async function templaterRan() {
		return getContext().obsidian.dev.evalJson<boolean>("window.__qaUserTextTemplaterRan === true");
	}

	afterEach(async () => {
		await getContext().obsidian.dev.evalJson("(() => { delete window.__qaUserTextTemplaterRan; return true; })()");
	});

	it("keeps Templater enabled for these tests", async () => {
		expect(await getContext().obsidian.dev.evalJson(`Boolean(app.plugins.plugins["templater-obsidian"]?.templater?.parse_template)`)).toBe(true);
	});

	it.each([
		["bottom", () => {}],
		["insert after", (choice: CaptureChoice) => {
			choice.prepend = false;
			choice.insertAfter.enabled = true;
			// Top of the section, and no heading creation: the defaults before #2007.
			choice.insertAfter.insertAtEnd = false;
			choice.insertAfter.createIfNotFound = false;
			choice.insertAfter.after = "## Log";
		}],
		["top", (choice: CaptureChoice) => { choice.prepend = false; }],
		["new file", (choice: CaptureChoice) => {
			choice.captureTo = choice.captureTo.replace(/\.md$/, "-new.md");
			choice.createFileIfItDoesntExist.enabled = true;
		}],
	])("captures a selected tag as text at the %s, and runs the format's own tag", async (_mode, configure) => {
		const { obsidian, sandbox } = getContext();
		const choice = await setup('<% "own:" + tp.file.title %> {{SELECTED}}', configure);
		await selectAll(await seedVaultFile(obsidian, sandbox, `source-${choice.id}.md`, `snippet ${TAG}`));

		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		const title = choice.captureTo.split("/").pop()!.slice(0, -3);
		await expect.poll(async () => (await read(choice.captureTo)) ?? "", POLL_OPTS).toContain(`own:${title} snippet ${TAG}`);
		expect(await templaterRan()).toBe(false);
	});

	it("captures a selected tag as text at the cursor", async () => {
		const { obsidian, sandbox } = getContext();
		const choice = await setup("{{SELECTED}}", (c) => {
			c.prepend = false;
			c.captureToActiveFile = true;
			c.activeFileWritePosition = "cursor";
		});
		const source = await seedVaultFile(obsidian, sandbox, `source-${choice.id}.md`, `snippet ${TAG}`);
		await selectAll(source);

		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		// The capture replaces the selection with the same text.
		await obsidian.dev.evalJsonAsync("(async () => { await app.workspace.activeLeaf.view.save(); return true; })()");
		expect(await read(source)).toBe(`snippet ${TAG}`);
		expect(await templaterRan()).toBe(false);
	});

	it("still gives a link value to a Templater tag in the format", async () => {
		const choice = await setup('<% "{{VALUE}}".toUpperCase() %>');

		await openLink(choice, "abc <% x %>");

		await expect.poll(() => captured(choice.captureTo), POLL_OPTS).toBe("# Inbox\n## Log\nABC <% X %>");
	});

	it("creates a Template note with a link value's tag as text and runs the template's own tag", async () => {
		const { obsidian, sandbox } = getContext();
		const choice = new TemplateChoice("Template user text");
		choice.onePageInput = "never";
		choice.templatePath = await seedVaultFile(obsidian, sandbox, `template-${choice.id}.md`,
			"---\nanswer: {{VALUE}}\n---\n<% tp.file.title %> {{VALUE}}");
		const path = sandbox.path(`note-${choice.id}.md`);
		choice.fileNameFormat = { enabled: true, format: path.slice(0, -3) };
		await save(choice);

		await openLink(choice, `v ${TAG}`);

		await expect.poll(() => read(path), POLL_OPTS).toBe(`---\nanswer: v ${TAG}\n---\nnote-${choice.id} v ${TAG}`);
		expect(await templaterRan()).toBe(false);
	});
});
