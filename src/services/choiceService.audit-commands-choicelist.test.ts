import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, type App } from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";

// --- Hoisted mock state -----------------------------------------------------
// Mirrors choiceService.test.ts: stub the GUI builders so importing the module
// does not pull in the full Obsidian/Svelte stack.

const mocks = vi.hoisted(() => ({
	yesNoPrompt: vi.fn(),
}));

vi.mock("../gui/ChoiceBuilder/templateChoiceBuilder", () => ({
	TemplateChoiceBuilder: class {},
}));
vi.mock("../gui/ChoiceBuilder/captureChoiceBuilder", () => ({
	CaptureChoiceBuilder: class {},
}));
vi.mock("../gui/MacroGUIs/MacroBuilder", () => ({ MacroBuilder: class {} }));
vi.mock("../gui/MultiChoiceSettingsModal", () => ({
	MultiChoiceSettingsModal: class {},
}));
vi.mock("../gui/GenericYesNoPrompt/GenericYesNoPrompt", () => ({
	default: {
		Prompt: (...args: unknown[]) => mocks.yesNoPrompt(...args),
	},
}));
vi.mock("../settingsStore", () => ({
	settingsStore: { getState: () => ({ choices: [] }) },
}));

const {
	createChoice,
	insertChoiceAfter,
	moveChoiceToRoot,
	deleteChoiceWithConfirmation,
} = await import("./choiceService");

const fakeApp = { name: "fake-app" } as unknown as App;

const makeMulti = (name: string, children: IChoice[] = []) => {
	const m = createChoice("Multi", name) as IMultiChoice;
	m.choices = children;
	return m;
};

describe("choiceService audit (commands-choicelist)", () => {
	beforeEach(() => {
		mocks.yesNoPrompt.mockReset();
		(Notice as unknown as { instances: unknown[] }).instances.length = 0;
	});

	describe("insertChoiceAfter (settings-choice-duplicate)", () => {
		it("inserts immediately after a top-level sibling, not at the end", () => {
			const a = createChoice("Template", "A");
			const b = createChoice("Template", "B");
			const c = createChoice("Template", "C");
			const copy = createChoice("Template", "A (copy)");

			const result = insertChoiceAfter([a, b, c], a.id, copy);

			expect(result).toBeDefined();
			expect((result as IChoice[]).map((x) => x.id)).toEqual([
				a.id,
				copy.id,
				b.id,
				c.id,
			]);
		});

		it("inserts next to a nested sibling inside its folder", () => {
			const inner = createChoice("Template", "Inner");
			const folder = makeMulti("Folder", [inner]);
			const copy = createChoice("Template", "Inner (copy)");

			const result = insertChoiceAfter([folder], inner.id, copy) as IChoice[];

			const newFolder = result[0] as IMultiChoice;
			expect(newFolder.choices!.map((x) => x.id)).toEqual([inner.id, copy.id]);
			// The copy lands in the SAME folder as its source, not at root.
			expect(result).toHaveLength(1);
		});

		it("returns undefined when the sibling id is not found (caller falls back to root)", () => {
			const a = createChoice("Template", "A");
			const copy = createChoice("Template", "A (copy)");
			expect(insertChoiceAfter([a], "missing", copy)).toBeUndefined();
		});
	});

	describe("moveChoiceToRoot (settings-choice-move-to-folder)", () => {
		it("moves a nested choice back to the top level", () => {
			const child = createChoice("Template", "Child");
			const folder = makeMulti("Folder", [child]);

			const result = moveChoiceToRoot([folder], child.id);

			const newFolder = result.find((c) => c.id === folder.id) as IMultiChoice;
			expect(newFolder.choices).toHaveLength(0);
			expect(result.some((c) => c.id === child.id)).toBe(true);
			// Appended at root.
			expect(result[result.length - 1].id).toBe(child.id);
		});

		it("is a no-op for a choice already at the top level", () => {
			const a = createChoice("Template", "A");
			const root = [a];
			expect(moveChoiceToRoot(root, a.id)).toBe(root);
		});

		it("is a no-op for a missing id", () => {
			const root = [createChoice("Template", "A")];
			expect(moveChoiceToRoot(root, "nope")).toBe(root);
		});
	});

	describe("deleteChoiceWithConfirmation count (multi-delete-recursive)", () => {
		it("counts the FULL nested subtree, not just direct children", async () => {
			mocks.yesNoPrompt.mockResolvedValue(true);
			// Outer folder has 1 direct child (a subfolder) holding 3 leaves.
			const subfolder = makeMulti("Sub", [
				createChoice("Template", "a"),
				createChoice("Template", "b"),
				createChoice("Template", "c"),
			]);
			const outer = makeMulti("Outer", [subfolder]);

			await deleteChoiceWithConfirmation(outer, fakeApp);

			const message = mocks.yesNoPrompt.mock.calls[0][2] as string;
			// 1 subfolder + 3 leaves = 4 descendants, counted by kind so the
			// subfolder is not called a "choice" (#1552) — NOT "1 choice".
			expect(message).toContain(
				"everything inside it: 3 choices and 1 folder.",
			);
			expect(message).not.toContain("1 choice and");
		});

		it("omits the scary warning for an empty folder", async () => {
			mocks.yesNoPrompt.mockResolvedValue(true);
			const empty = makeMulti("Empty");

			await deleteChoiceWithConfirmation(empty, fakeApp);

			const message = mocks.yesNoPrompt.mock.calls[0][2] as string;
			// The whole clause is absent, not merely zero-valued.
			expect(message).not.toContain("everything inside it");
			expect(message).toBe("Are you sure you want to delete 'Empty'?");
		});

		it("uses singular 'choice' for a folder with exactly one descendant", async () => {
			mocks.yesNoPrompt.mockResolvedValue(true);
			const one = makeMulti("One", [createChoice("Template", "only")]);

			await deleteChoiceWithConfirmation(one, fakeApp);

			const message = mocks.yesNoPrompt.mock.calls[0][2] as string;
			expect(message).toContain("everything inside it: 1 choice.");
			expect(message).not.toContain("1 choices");
		});

		it("counts folders alone when a folder holds only folders", async () => {
			mocks.yesNoPrompt.mockResolvedValue(true);
			const outer = makeMulti("Outer", [makeMulti("A"), makeMulti("B")]);

			await deleteChoiceWithConfirmation(outer, fakeApp);

			const message = mocks.yesNoPrompt.mock.calls[0][2] as string;
			expect(message).toContain("everything inside it: 2 folders.");
			expect(message).not.toContain("choices");
		});
	});
});
