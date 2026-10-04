import { afterEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { expectNoPrompt, jsLiteral, POLL_OPTS, pressKey, typeInto, waitForElement } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// #1879: the inline suggestion list is exactly as wide as its input (Obsidian
// caps suggestion lists at 500px, narrower than the text prompt's input), and
// long paths are not cut off inside it.
const getContext = createQuickAddE2EHarness("suggestion-list-width");

afterEach(async () => {
	const { obsidian } = getContext();
	for (let remaining = 5; remaining > 0; remaining--) {
		if (!await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container"))')) break;
		await pressKey(obsidian, "Escape");
	}
	await expectNoPrompt(obsidian);
});

type Box = { left: number; right: number; top: number; bottom: number };
type ListLayout = {
	input: Box;
	list: Box | null;
	actionsTop: number;
	// Scrollable width past the list's own width: a cut-off row.
	listOverflow: number;
	rows: Array<{ text: string; pathCut: boolean; pathWidth: number; height: number }>;
};

async function listLayout(inputSelector: string): Promise<ListLayout> {
	return getContext().obsidian.dev.evalJson<ListLayout>(`(() => {
		const box = (el) => {
			const { left, right, top, bottom } = el.getBoundingClientRect();
			return { left, right, top, bottom };
		};
		const input = document.querySelector(${jsLiteral(inputSelector)});
		const list = document.querySelector(".suggestion-container");
		const scroller = list?.querySelector(".suggestion");
		return {
			input: box(input),
			list: list ? box(list) : null,
			actionsTop: input.closest(".modal").querySelector(".qa-prompt-actions").getBoundingClientRect().top,
			listOverflow: scroller ? scroller.scrollWidth - scroller.clientWidth : 0,
			rows: Array.from(list?.querySelectorAll(".suggestion-item") ?? []).map((row) => {
				const path = row.querySelector(".suggestion-sub-text");
				return {
					text: row.textContent,
					pathCut: path ? path.scrollWidth > path.clientWidth : false,
					pathWidth: path ? path.clientWidth : 0,
					height: row.getBoundingClientRect().height,
				};
			}),
		};
	})()`);
}

it("matches a wide text prompt's input and shows note paths in full", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const inbox = await seedVaultFile(obsidian, sandbox, "Inbox.md", "# Inbox\n");
	const nora = await seedVaultFile(obsidian, sandbox, "Noravik.md", "# Noravik\n");
	const deep = await seedVaultFile(obsidian, sandbox,
		"Archive/Projects/2026/Q3 Planning/Meeting notes/Clients/Noravik archive.md", "# Noravik archive\n");
	const longName = await seedVaultFile(obsidian, sandbox,
		"Noravik kickoff with the whole regional team, agenda, decisions and every follow-up.md", "# Kickoff\n");
	const capture = new CaptureChoice("List width inbox");
	capture.captureTo = inbox;
	capture.onePageInput = "never";
	capture.format = { enabled: true, format: "- {{VALUE}}" };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [capture];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson(
		`(() => { void app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(capture.name)}).catch(() => {}); return true; })()`,
	);
	const input = ".qaInputPrompt input";
	await waitForElement(obsidian, input);
	await typeInto(obsidian, input, "Ask [[Noravik");
	await expect.poll(async () => (await listLayout(input)).rows.map((row) => row.text), POLL_OPTS)
		.toEqual(expect.arrayContaining([
			expect.stringContaining(nora),
			expect.stringContaining(deep),
			expect.stringContaining(longName),
		]));

	const layout = await listLayout(input);
	// Obsidian's 500px cap only shows on an input wider than that.
	expect(layout.input.right - layout.input.left).toBeGreaterThan(500);
	expect(layout.list?.left).toBeCloseTo(layout.input.left, 0);
	expect(layout.list?.right).toBeCloseTo(layout.input.right, 0);
	// #1839: the list still stays off the action bar.
	expect(layout.list!.bottom).toBeLessThanOrEqual(layout.actionsTop);
	const row = (path: string) => layout.rows.find((candidate) => candidate.text.includes(path))!;
	// The ~330px sandbox path fits beside the short name; a path too long for
	// its row is ellipsized on one line, like the rest; and a name as wide as
	// the row still leaves part of its path visible.
	expect(row(nora).pathCut).toBe(false);
	expect(row(deep).pathCut).toBe(true);
	expect(row(deep).height).toBe(row(nora).height);
	expect(row(longName).pathWidth).toBeGreaterThan(100);
});

it("wraps a long value without spaces instead of cutting it off", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const source = "https://example.com/QuickAddSuggestionListWidthRegressionCheckWithoutAnyBreaks";
	await seedVaultFile(obsidian, sandbox, "Sources/a.md", `---\nsource: ${source}\n---\n`);
	const folder = sandbox.path("Sources");
	const template = new TemplateChoice("List width form");
	template.onePageInput = "always";
	template.templatePath = await seedVaultFile(obsidian, sandbox, "form-template.md",
		`source: {{FIELD:source|folder:${folder}|label:Source}}\n`);
	template.fileNameFormat = { enabled: true, format: "list-width" };
	template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("out")] };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [template];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson(
		`(() => { void app.plugins.plugins.quickadd.api.executeChoice(${jsLiteral(template.name)}).catch(() => {}); return true; })()`,
	);
	const input = ".onePageInputModal .setting-item-control input";
	await waitForElement(obsidian, input);
	await typeInto(obsidian, input, "example");
	await expect.poll(async () => (await listLayout(input)).rows.map((row) => row.text), POLL_OPTS)
		.toEqual([source]);

	const layout = await listLayout(input);
	expect(layout.list?.left).toBeCloseTo(layout.input.left, 0);
	expect(layout.list?.right).toBeCloseTo(layout.input.right, 0);
	expect(layout.listOverflow).toBe(0);
});
