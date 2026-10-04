import type { CliData } from "obsidian";
import { describe, expect, it } from "vitest";
import { listChoicesHandler } from "../../src/cli/inspectChoices";
import type QuickAdd from "../../src/main";
import { walkChoiceTree } from "../../src/migrations/helpers/choice-traversal";
import { normalizeImportedChoice } from "../../src/services/packageChoiceImport";
import type IChoice from "../../src/types/choices/IChoice";
import { lowerNode } from "../../src/v3/lower";
import { migrateChoice } from "../../src/v3/migrate";
import { FIXTURE } from "./fixture";
import { packageChoices } from "./packages";

const list = (choices: IChoice[], params: CliData = {}) =>
	listChoicesHandler({ settings: { choices } } as unknown as QuickAdd, params);
const lowered = (choices: IChoice[]) => choices.map((choice) => lowerNode(migrateChoice(choice).node));

describe("quickadd:list over lowered actions", () => {
	const choices = [...packageChoices().map(({ choice }) => choice), ...FIXTURE];

	it("reports the same id, name, type, command, path and writes as v2", () => {
		expect(list(lowered(choices))).toEqual(list(choices));
	});

	it.each(["Template", "Capture", "Macro", "Multi"])("filters by type=%s the same way", (type) => {
		expect(list(lowered(choices), { type })).toEqual(list(choices, { type }));
	});

	// The two packages tests/e2e/cli-list-writes.test.ts imports and lists.
	it("keeps what cli-list-writes expects", () => {
		const imported = (choice: Record<string, unknown>) => {
			walkChoiceTree(choice as unknown as IChoice, normalizeImportedChoice);
			return choice as unknown as IChoice;
		};
		const log = imported({
			id: "qa-e2e-log", name: "Log", type: "Capture", captureTo: "journal.md", task: true,
			format: { enabled: true, format: "{{VALUE:item}} #{{VALUE:project}}\n" },
			insertAfter: { enabled: true, after: "## Log" },
		});
		const flags = imported({
			id: "qa-e2e-flags", name: "Flags", type: "Capture", captureTo: "flags.md", prepend: true,
			insertBefore: { enabled: true, before: "## End" },
			newLineCapture: { enabled: true, direction: "above" },
		});
		const result = list(lowered([log, flags]), { type: "Capture" }) as { choices: { id: string; writes?: unknown }[] };
		expect(result.choices.find((choice) => choice.id === "qa-e2e-log")?.writes).toEqual({
			target: "journal.md",
			position: "after",
			line: "## Log",
			format: "{{VALUE:item}} #{{VALUE:project}}\n",
			task: true,
		});
		expect(result.choices.find((choice) => choice.id === "qa-e2e-flags")?.writes).toMatchObject({ position: "bottom" });
	});
});
