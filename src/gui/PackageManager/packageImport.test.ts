import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { settingsStore } from "../../settingsStore";
import type IChoice from "../../types/choices/IChoice";
import type { QuickAddPackage } from "../../types/packages/QuickAddPackage";
import { QUICKADD_PACKAGE_SCHEMA_VERSION } from "../../types/packages/QuickAddPackage";

const applied = vi.hoisted(() => ({ calls: [] as { existing: IChoice[]; assets: { mode: string }[] }[], during: null as null | (() => void) }));

vi.mock("../../services/packageImportService", async (importOriginal) => ({
	...(await importOriginal<object>()),
	applyPackageImport: vi.fn(async (options: { existingChoices: IChoice[]; assetDecisions: { mode: string }[]; pkg: QuickAddPackage }) => {
		applied.calls.push({ existing: options.existingChoices, assets: options.assetDecisions });
		await Promise.resolve();
		const during = applied.during;
		applied.during = null;
		during?.();
		return {
			updatedChoices: [...options.existingChoices, ...options.pkg.choices.map((entry) => entry.choice)],
			addedChoiceIds: options.pkg.choices.map((entry) => entry.choice.id),
			overwrittenChoiceIds: [],
			skippedChoiceIds: [],
			writtenAssets: options.assetDecisions.filter((d) => d.mode === "write").map(() => "Templates/T.md"),
			skippedAssets: [],
		};
	}),
}));

import { importPackage } from "./packageImport";

const choice = (id: string): IChoice => ({ id, name: id, type: "Capture", command: false }) as IChoice;
const pkg: QuickAddPackage = {
	schemaVersion: QUICKADD_PACKAGE_SCHEMA_VERSION,
	quickAddVersion: "3.0.0",
	createdAt: "2026-10-05T00:00:00.000Z",
	rootChoiceIds: ["imported"],
	choices: [{ choice: choice("imported"), parentChoiceId: null, pathHint: [] }],
	assets: [{ kind: "template", originalPath: "T.md", contentEncoding: "base64", content: "" }],
};
const removed: string[] = [];
const app = { vault: { adapter: { remove: async (path: string) => { removed.push(path); } } } } as unknown as App;

describe("importPackage", () => {
	beforeEach(() => {
		applied.calls = [];
		applied.during = null;
		removed.length = 0;
		settingsStore.setState((state) => ({ ...state, choices: [choice("mine")] }));
	});

	it("replaces the choices it was computed from", async () => {
		await importPackage({ app, pkg, choiceDecisions: [], assetDecisions: [{ originalPath: "T.md", destinationPath: "Templates/T.md", mode: "write" }] });
		expect(settingsStore.getState().choices.map((entry) => entry.id)).toEqual(["mine", "imported"]);
		expect(applied.calls).toHaveLength(1);
	});

	it("keeps a choice added while the files were written, and the files where they landed", async () => {
		applied.during = () => settingsStore.setState((state) => ({ ...state, choices: [...state.choices, choice("meanwhile")] }));
		const { previousChoices } = await importPackage({ app, pkg, choiceDecisions: [], assetDecisions: [{ originalPath: "T.md", destinationPath: "Templates/T.md", mode: "write" }] });
		expect(settingsStore.getState().choices.map((entry) => entry.id)).toEqual(["mine", "meanwhile", "imported"]);
		// What the import replaced, for the command sync that diffs against it.
		expect(previousChoices.map((entry) => entry.id)).toEqual(["mine", "meanwhile"]);
		expect(applied.calls).toHaveLength(2);
		expect(applied.calls[1]?.existing.map((entry) => entry.id)).toEqual(["mine", "meanwhile"]);
		expect(applied.calls[1]?.assets).toEqual([{ originalPath: "T.md", destinationPath: "Templates/T.md", mode: "skip" }]);
	});

	it("gives up on choices that never stop changing, taking the files it created with it", async () => {
		const keepChanging = () => {
			settingsStore.setState((state) => ({ ...state, choices: [...state.choices, choice(`edit-${state.choices.length}`)] }));
			applied.during = keepChanging;
		};
		applied.during = keepChanging;
		const before = settingsStore.getState().choices;
		await expect(importPackage({ app, pkg, choiceDecisions: [], assetDecisions: [{ originalPath: "T.md", destinationPath: "Templates/T.md", mode: "write" }] }))
			.rejects.toThrow("Nothing was imported");
		expect(settingsStore.getState().choices.map((entry) => entry.id)).not.toContain("imported");
		expect(settingsStore.getState().choices.length).toBeGreaterThan(before.length);
		expect(removed).toEqual(["Templates/T.md"]);
	});
});
