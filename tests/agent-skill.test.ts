import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// The formatter graph pulls obsidian-dataview's CJS require("obsidian").
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
import type QuickAdd from "../src/main";
import type ICaptureChoice from "../src/types/choices/ICaptureChoice";
import { registerQuickAddCliHandlers } from "../src/cli/registerQuickAddCliHandlers";
import { applyPackageImport, parseQuickAddPackage } from "../src/services/packageImportService";
import { getWritePosition } from "../src/engine/captureAction";

// skills/quickadd/SKILL.md is what agents follow. It is prose next to code that
// changes, so check the parts an agent copies verbatim.
const skill = readFileSync(path.resolve(__dirname, "../skills/quickadd/SKILL.md"), "utf8");

describe("the QuickAdd agent skill", () => {
	it("only names CLI commands QuickAdd registers", () => {
		const registered: string[] = [];
		registerQuickAddCliHandlers({
			registerCliHandler: vi.fn((command: string) => registered.push(command)),
		} as unknown as QuickAdd);

		const named = [...new Set(skill.match(/\bquickadd(?::[a-z-]+)?(?=\s)/g))];

		expect(named.length).toBeGreaterThan(3);
		expect(registered).toEqual(expect.arrayContaining(named));
	});

	it("shows a package that imports as a complete Capture appending to the bottom", async () => {
		// \r?\n: a Windows checkout gives the file CRLF line endings.
		const example = /## Create a new choice[\s\S]*?```json\r?\n([\s\S]*?)```/.exec(skill)?.[1];
		const pkg = parseQuickAddPackage(example ?? "");

		const result = await applyPackageImport({
			app: { vault: { adapter: { exists: async () => false } } } as never,
			existingChoices: [],
			pkg,
			choiceDecisions: pkg.choices.map((entry) => ({ choiceId: entry.choice.id, mode: "import" })),
			assetDecisions: [],
		});

		const capture = result.updatedChoices[0] as ICaptureChoice;
		expect(capture).toMatchObject({
			type: "Capture",
			createFileIfItDoesntExist: { enabled: true, createWithTemplate: false },
			insertAfter: { enabled: false },
			newLineCapture: { enabled: false },
		});
		// The example is introduced as a log you append to.
		expect(getWritePosition(capture)).toBe("bottom");
	});
});
