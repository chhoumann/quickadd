import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import type { QuickAddPackage } from "../../src/types/packages/QuickAddPackage";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

// #1976: imported choices skipped the normalization an older data.json gets, so
// a Capture that left out settings failed on every run and an exported
// Template's "Increment the file name" turned into a prompt.
const getContext = createQuickAddE2EHarness("package-import-normalize");

type RunResult = { ok: boolean; error?: string; effect?: string; file?: string };

function packageOf(choice: Record<string, unknown>): QuickAddPackage {
	return {
		schemaVersion: 1,
		quickAddVersion: "2.5.0",
		createdAt: "2025-11-01T00:00:00.000Z",
		rootChoiceIds: [String(choice.id)],
		choices: [{ choice: choice as unknown as IChoice, pathHint: [], parentChoiceId: null }],
		assets: [],
	};
}

it("runs a Capture imported with only the settings it sets", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	// The import writes data.json through the plugin; a no-op patch snapshots it
	// so the per-test restore removes the imported choice.
	await plugin.data<{ choices: IChoice[] }>().patch(() => undefined);
	// Left-out "Create note if it doesn't exist" defaults to off, as for a new
	// Capture, so the target has to exist.
	const target = await seedVaultFile(obsidian, sandbox, "reading.md", "");
	const packagePath = await seedVaultFile(obsidian, sandbox, "minimal.quickadd.json", JSON.stringify(packageOf({
		id: "qa-e2e-minimal-capture",
		name: "Minimal capture",
		type: "Capture",
		captureTo: target,
		format: { enabled: true, format: "- {{VALUE}}\n" },
	})));

	const imported = await obsidian.execJson<{ ok: boolean; added?: string[] }>("quickadd:package-import", { path: packagePath });
	expect(imported).toMatchObject({ ok: true, added: ["qa-e2e-minimal-capture"] });

	const run = await obsidian.execJson<RunResult>("quickadd:run", {
		id: "qa-e2e-minimal-capture",
		"value-value": "Dune",
		verify: "true",
	});
	expect(run).toMatchObject({ ok: true, effect: "changed", file: target });
	await expect(sandbox.waitForContent("reading.md", (content) => content.includes("- Dune"))).resolves.toContain("- Dune");
});

it("keeps an exported Template's Increment the file name setting", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(() => undefined);
	const templatePath = await seedVaultFile(obsidian, sandbox, "templates/Sync.md", "# {{VALUE:topic}}\n");
	const packagePath = await seedVaultFile(obsidian, sandbox, "old-template.quickadd.json", JSON.stringify(packageOf({
		id: "qa-e2e-old-template",
		name: "Old template",
		type: "Template",
		command: false,
		templatePath,
		fileNameFormat: { enabled: true, format: "Sync {{VALUE:topic}}" },
		folder: { enabled: true, folders: [sandbox.path("notes")], chooseWhenCreatingNote: false, createInSameFolderAsActiveFile: false, chooseFromSubfolders: false },
		appendLink: false,
		openFile: false,
		fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: true },
		fileExistsMode: "Increment the file name",
		setFileExistsBehavior: true,
	})));

	await obsidian.execJson("quickadd:package-import", { path: packagePath });
	const runOnce = () => obsidian.execJson<RunResult>("quickadd:run", {
		id: "qa-e2e-old-template",
		vars: JSON.stringify({ topic: "Weekly" }),
		verify: "true",
	});

	expect(await runOnce()).toMatchObject({ ok: true, effect: "created", file: sandbox.path("notes/Sync Weekly.md") });
	expect(await runOnce()).toMatchObject({ ok: true, effect: "created", file: sandbox.path("notes/Sync Weekly1.md") });
});

it("runs a partial Capture that an imported Macro embeds inside another Macro", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(() => undefined);
	const target = await seedVaultFile(obsidian, sandbox, "deep.md", "");
	const nestedStep = (id: string, choice: Record<string, unknown>) => ({ id, name: String(choice.name), type: "NestedChoice", choice });
	const packagePath = await seedVaultFile(obsidian, sandbox, "embedded.quickadd.json", JSON.stringify(packageOf({
		id: "qa-e2e-outer-macro",
		name: "Outer macro",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: "qa-e2e-outer-def",
			name: "Outer macro",
			commands: [nestedStep("qa-e2e-outer-step", {
				id: "qa-e2e-inner-macro",
				name: "Inner macro",
				type: "Macro",
				command: false,
				runOnStartup: false,
				macro: {
					id: "qa-e2e-inner-def",
					name: "Inner macro",
					commands: [nestedStep("qa-e2e-inner-step", {
						id: "qa-e2e-deep-capture",
						name: "Deep capture",
						type: "Capture",
						captureTo: target,
						format: { enabled: true, format: "- {{VALUE}}\n" },
					})],
				},
			})],
		},
	})));

	const imported = await obsidian.execJson<{ ok: boolean }>("quickadd:package-import", { path: packagePath });
	expect(imported.ok).toBe(true);

	const run = await obsidian.execJson<RunResult>("quickadd:run", { id: "qa-e2e-outer-macro", "value-value": "Arrakis" });
	expect(run).toMatchObject({ ok: true });
	await expect(sandbox.waitForContent("deep.md", (content) => content.includes("- Arrakis"))).resolves.toContain("- Arrakis");
});

it("keeps an exported choice's legacy open-in-split setting", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(() => undefined);
	const packagePath = await seedVaultFile(obsidian, sandbox, "legacy-open.quickadd.json", JSON.stringify(packageOf({
		id: "qa-e2e-legacy-open",
		name: "Legacy open",
		type: "Capture",
		command: false,
		captureTo: sandbox.path("legacy-open.md"),
		openFile: true,
		openFileInNewTab: { enabled: true, direction: "horizontal", focus: false },
		openFileInMode: "source",
	})));

	await obsidian.execJson("quickadd:package-import", { path: packagePath });

	const fileOpening = await obsidian.dev.evalJson<unknown>(
		`app.plugins.plugins.quickadd.settings.choices.find((choice) => choice.id === "qa-e2e-legacy-open")?.fileOpening ?? null`,
	);
	expect(fileOpening).toEqual({ location: "split", direction: "horizontal", mode: "source", focus: false });
});
