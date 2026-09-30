import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";

// {{linksection}} must only link to headings Obsidian itself resolves (#1906).
const getContext = createQuickAddE2EHarness("link-section");

const note = (block: string) =>
	`# Weekly sync\n\n## Decisions\n\n- Ship v2 on Friday\n\n${block}\n\n- Bob owns the rollout\n`;

async function setup(block: string, eol = "\n") {
	const { obsidian, sandbox, plugin } = getContext();
	const body = note(block);
	const path = await seedVaultFile(obsidian, sandbox, "Meeting notes.md", body.replace(/\n/g, eol));
	const inbox = await seedVaultFile(obsidian, sandbox, "Inbox.md", "");
	const choice = new CaptureChoice("Link section");
	choice.captureTo = inbox;
	choice.onePageInput = "never";
	choice.format = { enabled: true, format: "{{linksection}}" };
	await plugin.data<{ choices: IChoice[] }>().patch(data => { data.choices.push(choice); });
	await plugin.reload({ waitUntilReady: true });
	await expect.poll(() => headings(path), POLL_OPTS).toContain("Decisions");
	await obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)}), { state: { mode: "source" } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		leaf.view.editor.setCursor({ line: ${body.split("\n").indexOf("- Bob owns the rollout")}, ch: 0 });
		return true;
	})()`);
	return { choice, inbox, path };
}

function headings(path: string) {
	return getContext().obsidian.dev.evalJson<string[]>(`(() =>
		(app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))?.headings ?? []).map(h => h.heading)
	)()`);
}

function read(path: string) {
	return getContext().obsidian.dev.evalJsonAsync<string>(`(async () =>
		await app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))
	)()`);
}

describe("{{linksection}} in native Obsidian", () => {
	it.each([
		["an Obsidian comment", "%%\n## Parking lot\n- revisit pricing\n%%", "\n"],
		["an HTML comment", "<!--\n## Parking lot\n-->", "\n"],
		["an HTML block", "<div>\n## Parking lot\n</div>", "\n"],
		["a math block", "$$\n# x = 1\n$$", "\n"],
		["an Obsidian comment in a CRLF file", "%%\n## Parking lot\n%%", "\r\n"],
	])("ignores a heading-like line inside %s in a saved note", async (_, block, eol) => {
		const { choice, inbox, path } = await setup(block, eol);
		expect(await getContext().obsidian.dev.evalJson<boolean>(`app.workspace.activeLeaf.view.data.includes("\\r")`))
			.toBe(eol === "\r\n");
		const result = await getContext().obsidian.execJson("quickadd:run", { id: choice.id, verify: true });
		expect(result).toMatchObject({ ok: true, verified: true });
		expect(await headings(path)).toEqual(["Weekly sync", "Decisions"]);
		expect(await read(inbox)).toContain("Meeting notes#Decisions]]");
	});

	// Through the script API, which formats right away (a Capture choice awaits
	// enough first that the cache usually catches up).
	it("links a heading renamed and saved before Obsidian re-reads it", async () => {
		await setup("- revisit pricing");
		const result = await getContext().obsidian.dev.evalJsonAsync<{ stale: boolean; link: string }>(`(async () => {
			const view = app.workspace.activeLeaf.view;
			view.editor.replaceRange("Outcomes", { line: 2, ch: 3 }, { line: 2, ch: 12 });
			await view.save();
			const stale = app.metadataCache.getFileCache(view.file).headings.some(h => h.heading === "Decisions");
			return { stale, link: await app.plugins.plugins.quickadd.api.format("{{linksection}}") };
		})()`);
		expect(result.stale).toBe(true);
		expect(result.link).toContain("Meeting notes#Outcomes]]");
	});

	// #2030: a heading added and saved is missing from the cache for a few ms.
	it("links a heading added and saved before Obsidian re-reads it", async () => {
		await setup("- revisit pricing");
		const result = await getContext().obsidian.dev.evalJsonAsync<{ stale: boolean; link: string }>(`(async () => {
			const view = app.workspace.activeLeaf.view;
			const line = view.editor.getValue().split("\\n").indexOf("- Bob owns the rollout");
			view.editor.replaceRange("## Rollout\\n", { line, ch: 0 });
			view.editor.setCursor({ line: line + 1, ch: 0 });
			await view.save();
			const stale = !app.metadataCache.getFileCache(view.file).headings.some(h => h.heading === "Rollout");
			return { stale, link: await app.plugins.plugins.quickadd.api.format("{{linksection}}") };
		})()`);
		expect(result.stale).toBe(true);
		expect(result.link).toContain("Meeting notes#Rollout]]");
	});

	it("links a just-typed heading before the note is saved", async () => {
		const { choice, inbox } = await setup("%%\n## Parking lot\n%%");
		const dirty = await getContext().obsidian.dev.evalJsonAsync<boolean>(`(async () => {
			const view = app.workspace.activeLeaf.view;
			const line = view.editor.getCursor().line;
			view.editor.replaceRange("## Rollout\\n", { line, ch: 0 });
			view.editor.setCursor({ line: line + 1, ch: 0 });
			const dirty = view.data !== view.editor.getValue();
			await app.plugins.plugins.quickadd.api.executeChoice(${JSON.stringify(choice.name)});
			return dirty;
		})()`);
		expect(dirty).toBe(true);
		expect(await read(inbox)).toContain("Meeting notes#Rollout]]");
	});
});
