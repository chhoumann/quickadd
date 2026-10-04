import { expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";

// #2163: a callout that Create line if not found adds next to a blockquote must
// render as its own callout, at Bottom and at Top.
const getContext = createQuickAddE2EHarness("capture-create-line-blockquote");

function createLineCapture(name: string, path: string, after: string, location: "top" | "bottom") {
	const choice = new CaptureChoice(name);
	choice.captureTo = path;
	choice.onePageInput = "never";
	choice.format = { enabled: true, format: "> {{VALUE}}" };
	choice.insertAfter = {
		...choice.insertAfter,
		enabled: true,
		after,
		insertAtEnd: true,
		createIfNotFound: true,
		createIfNotFoundLocation: location,
	};
	return choice;
}

async function rendered(path: string) {
	const { obsidian } = getContext();
	return obsidian.dev.evalJsonAsync<{ callouts: string[]; quotes: string[] }>(`(async () => {
		const leaf = app.workspace.getLeaf(true);
		await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(path)}), { state: { mode: "preview" } });
		const view = leaf.view.previewMode.containerEl;
		for (let i = 0; i < 50 && !view.querySelector("blockquote, .callout"); i++) {
			await new Promise((r) => setTimeout(r, 100));
		}
		const text = (el) => el.textContent.trim().split(/\\n+/).join(" | ");
		const result = {
			callouts: [...view.querySelectorAll(".callout")].map(text),
			quotes: [...view.querySelectorAll("blockquote")].map(text),
		};
		leaf.detach();
		return result;
	})()`);
}

it("Bottom: a created callout below a blockquote renders as a callout, and later entries go inside it", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const path = await seedVaultFile(obsidian, sandbox, "Bottom log.md", "# Log\n\n> An existing quote\n");
	const choice = createLineCapture("Callout at bottom", path, "> [!info]- Captured today", "bottom");
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [choice];
	}));
	await plugin.reload({ waitUntilReady: true });

	for (const value of ["first", "second"]) {
		await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, vars: JSON.stringify({ value }) });
	}

	await expect.poll(() => sandbox.read("Bottom log.md")).toBe(
		"# Log\n\n> An existing quote\n\n> [!info]- Captured today\n> first\n> second",
	);
	expect(await rendered(path)).toEqual({
		callouts: ["Captured today | first | second"],
		quotes: ["An existing quote"],
	});
});

it("Top: a created block ending in a quote above a callout leaves the callout rendering", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const path = await seedVaultFile(obsidian, sandbox, "Top log.md", "> [!info]- Captured today\n> a callout line\n");
	const choice = createLineCapture("Quote at top", path, "## Quotes", "top");
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [choice];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, vars: JSON.stringify({ value: "first quote" }) });

	await expect.poll(() => sandbox.read("Top log.md")).toBe(
		"## Quotes\n> first quote\n\n> [!info]- Captured today\n> a callout line\n",
	);
	expect(await rendered(path)).toEqual({
		callouts: ["Captured today | a callout line"],
		quotes: ["first quote"],
	});
});
