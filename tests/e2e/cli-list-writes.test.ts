import { expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import type { QuickAddPackage } from "../../src/types/packages/QuickAddPackage";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

// The loop the agent skill (skills/quickadd/SKILL.md) teaches: pick a choice by
// what `quickadd:list` says it writes, ask `quickadd:check` for its inputs, run
// it with `verify`.
const getContext = createQuickAddE2EHarness("cli-list-writes");

type ListedChoice = { id: string; writes?: Record<string, unknown> };

it("lists what a choice writes, and the run writes exactly there", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(() => undefined);
	const journal = await seedVaultFile(obsidian, sandbox, "journal.md", "# Journal\n\n## Log\n\n## Notes\nkeep\n");
	const pkg: QuickAddPackage = {
		schemaVersion: 1,
		quickAddVersion: "2.29.0",
		createdAt: "2026-09-30T00:00:00.000Z",
		rootChoiceIds: ["qa-e2e-log"],
		choices: [{
			choice: {
				id: "qa-e2e-log",
				name: "Log",
				type: "Capture",
				captureTo: journal,
				task: true,
				format: { enabled: true, format: "{{VALUE:item}} #{{VALUE:project}}\n" },
				insertAfter: { enabled: true, after: "## Log" },
			} as unknown as IChoice,
			pathHint: [],
			parentChoiceId: null,
		}],
		assets: [],
	};
	const packagePath = await seedVaultFile(obsidian, sandbox, "log.quickadd.json", JSON.stringify(pkg));
	await obsidian.execJson("quickadd:package-import", { path: packagePath });

	const list = await obsidian.execJson<{ choices: ListedChoice[] }>("quickadd:list", { type: "Capture" });
	expect(list.choices.find((choice) => choice.id === "qa-e2e-log")?.writes).toEqual({
		target: journal,
		position: "after",
		line: "## Log",
		format: "{{VALUE:item}} #{{VALUE:project}}\n",
		task: true,
	});

	const check = await obsidian.execJson<{ missing: { id: string }[] }>("quickadd:check", { id: "qa-e2e-log" });
	expect(check.missing.map((field) => field.id)).toEqual(["item", "project"]);

	const run = await obsidian.execJson<{ ok: boolean; effect?: string; file?: string }>("quickadd:run", {
		id: "qa-e2e-log",
		vars: JSON.stringify({ item: "Review the PR", project: "quickadd" }),
		verify: "true",
	});
	expect(run).toMatchObject({ ok: true, effect: "changed", file: journal });
	await expect(sandbox.waitForContent("journal.md", (content) => content.includes("Review the PR")))
		.resolves.toBe("# Journal\n\n## Log\n\n- [ ] Review the PR #quickadd\n\n## Notes\nkeep\n");
});

it("reports where a Capture with contradictory position flags really writes", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch(() => undefined);
	const note = await seedVaultFile(obsidian, sandbox, "flags.md", "# Flags\n\n## End\n");
	// A hand-written package can set flags the builder keeps exclusive.
	const packagePath = await seedVaultFile(obsidian, sandbox, "flags.quickadd.json", JSON.stringify({
		schemaVersion: 1,
		quickAddVersion: "2.29.0",
		createdAt: "2026-09-30T00:00:00.000Z",
		rootChoiceIds: ["qa-e2e-flags"],
		choices: [{
			choice: {
				id: "qa-e2e-flags",
				name: "Flags",
				type: "Capture",
				captureTo: note,
				prepend: true,
				insertBefore: { enabled: true, before: "## End" },
				newLineCapture: { enabled: true, direction: "above" },
			},
			pathHint: [],
			parentChoiceId: null,
		}],
		assets: [],
	}));
	await obsidian.execJson("quickadd:package-import", { path: packagePath });

	const list = await obsidian.execJson<{ choices: ListedChoice[] }>("quickadd:list", { type: "Capture" });
	expect(list.choices.find((choice) => choice.id === "qa-e2e-flags")?.writes).toMatchObject({ position: "bottom" });

	await obsidian.execJson("quickadd:run", { id: "qa-e2e-flags", "value-value": "last", verify: "true" });
	await expect(sandbox.waitForContent("flags.md", (content) => content.includes("last")))
		.resolves.toBe("# Flags\n\n## End\nlast");
});
