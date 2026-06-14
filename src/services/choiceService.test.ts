import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";

// --- Hoisted mock state -----------------------------------------------------

const mocks = vi.hoisted(() => ({
	templateBuilder: vi.fn(),
	captureBuilder: vi.fn(),
	macroBuilder: vi.fn(),
	multiModal: vi.fn(),
	yesNoPrompt: vi.fn(),
	storeChoices: [] as IChoice[],
}));

// Mock the GUI builders so importing the module does not pull in the full
// Obsidian/Svelte stack. Each constructor records its args and exposes a
// resolvable `waitForClose`.
vi.mock("../gui/ChoiceBuilder/templateChoiceBuilder", () => ({
	TemplateChoiceBuilder: class {
		app: unknown;
		choice: unknown;
		plugin: unknown;
		waitForClose: Promise<IChoice | undefined>;
		constructor(app: unknown, choice: unknown, plugin: unknown) {
			this.app = app;
			this.choice = choice;
			this.plugin = plugin;
			this.waitForClose = mocks.templateBuilder(app, choice, plugin);
		}
	},
}));

vi.mock("../gui/ChoiceBuilder/captureChoiceBuilder", () => ({
	CaptureChoiceBuilder: class {
		app: unknown;
		choice: unknown;
		plugin: unknown;
		waitForClose: Promise<IChoice | undefined>;
		constructor(app: unknown, choice: unknown, plugin: unknown) {
			this.app = app;
			this.choice = choice;
			this.plugin = plugin;
			this.waitForClose = mocks.captureBuilder(app, choice, plugin);
		}
	},
}));

vi.mock("../gui/MacroGUIs/MacroBuilder", () => ({
	MacroBuilder: class {
		app: unknown;
		plugin: unknown;
		choice: unknown;
		choices: unknown;
		waitForClose: Promise<IChoice | undefined>;
		constructor(
			app: unknown,
			plugin: unknown,
			choice: unknown,
			choices: unknown,
		) {
			this.app = app;
			this.plugin = plugin;
			this.choice = choice;
			this.choices = choices;
			this.waitForClose = mocks.macroBuilder(app, plugin, choice, choices);
		}
	},
}));

vi.mock("../gui/MultiChoiceSettingsModal", () => ({
	MultiChoiceSettingsModal: class {
		app: unknown;
		choice: unknown;
		waitForClose: Promise<IChoice | undefined>;
		constructor(app: unknown, choice: unknown) {
			this.app = app;
			this.choice = choice;
			this.waitForClose = mocks.multiModal(app, choice);
		}
	},
}));

vi.mock("../gui/GenericYesNoPrompt/GenericYesNoPrompt", () => ({
	default: {
		Prompt: (...args: unknown[]) => mocks.yesNoPrompt(...args),
	},
}));

vi.mock("../settingsStore", () => ({
	settingsStore: {
		getState: () => ({ choices: mocks.storeChoices }),
	},
}));

const {
	createChoice,
	duplicateChoice,
	getChoiceBuilder,
	deleteChoiceWithConfirmation,
	configureChoice,
	createToggleCommandChoice,
	toggleShareMenuById,
	CommandRegistry,
	moveChoice,
} = await import("./choiceService");

const { TemplateChoice } = await import("../types/choices/TemplateChoice");
const { CaptureChoice } = await import("../types/choices/CaptureChoice");
const { MacroChoice } = await import("../types/choices/MacroChoice");
const { MultiChoice } = await import("../types/choices/MultiChoice");

// Minimal fakes — App/QuickAdd are only used as opaque references here.
const fakeApp = { name: "fake-app" } as unknown as App;

describe("choiceService", () => {
	beforeEach(() => {
		mocks.templateBuilder.mockReset();
		mocks.captureBuilder.mockReset();
		mocks.macroBuilder.mockReset();
		mocks.multiModal.mockReset();
		mocks.yesNoPrompt.mockReset();
		mocks.storeChoices = [];
	});

	describe("createChoice", () => {
		it("creates a TemplateChoice", () => {
			const choice = createChoice("Template", "My Template");
			expect(choice).toBeInstanceOf(TemplateChoice);
			expect(choice.type).toBe("Template");
			expect(choice.name).toBe("My Template");
			expect(choice.command).toBe(false);
			expect(typeof choice.id).toBe("string");
			expect(choice.id.length).toBeGreaterThan(0);
		});

		it("creates a CaptureChoice", () => {
			const choice = createChoice("Capture", "Cap");
			expect(choice).toBeInstanceOf(CaptureChoice);
			expect(choice.type).toBe("Capture");
		});

		it("creates a MacroChoice with an attached macro", () => {
			const choice = createChoice("Macro", "Mac") as IMacroChoice;
			expect(choice).toBeInstanceOf(MacroChoice);
			expect(choice.type).toBe("Macro");
			expect(choice.macro).toBeDefined();
			expect(choice.macro.commands).toEqual([]);
		});

		it("creates a MultiChoice with an empty child list", () => {
			const choice = createChoice("Multi", "Multi") as IMultiChoice;
			expect(choice).toBeInstanceOf(MultiChoice);
			expect(choice.type).toBe("Multi");
			expect(choice.choices).toEqual([]);
		});

		it("gives each created choice a unique id", () => {
			const a = createChoice("Template", "A");
			const b = createChoice("Template", "B");
			expect(a.id).not.toBe(b.id);
		});

		it("throws for an unknown choice type", () => {
			expect(() =>
				createChoice("Bogus" as unknown as "Template", "x"),
			).toThrow("Unknown choice type: Bogus");
		});
	});

	describe("duplicateChoice", () => {
		it("appends ' (copy)' to the name and assigns a new id", () => {
			const original = createChoice("Template", "Source");
			const copy = duplicateChoice(original);
			expect(copy.name).toBe("Source (copy)");
			expect(copy.id).not.toBe(original.id);
			expect(copy.type).toBe("Template");
		});

		it("copies simple props except id and name", () => {
			const original = createChoice("Capture", "Cap") as ITemplateChoice;
			// Mutate a simple property to verify it is carried over.
			(original as unknown as { command: boolean }).command = true;
			const copy = duplicateChoice(original);
			expect(copy.command).toBe(true);
			expect(copy.name).toBe("Cap (copy)");
			expect(copy.id).not.toBe(original.id);
		});

		it("preserves command and onePageInput when duplicating a Multi", () => {
			const original = createChoice("Multi", "M") as IMultiChoice;
			(original as unknown as { command: boolean }).command = true;
			(original as unknown as { onePageInput: string }).onePageInput =
				"always";
			original.choices = [createChoice("Capture", "Child")];

			const copy = duplicateChoice(original) as IMultiChoice;

			expect(copy.command).toBe(true);
			expect(
				(copy as unknown as { onePageInput?: string }).onePageInput,
			).toBe("always");
			// children still duplicated with fresh ids
			expect(copy.choices[0].id).not.toBe(original.choices[0].id);
		});

		it("deep clones a Macro's macro and regenerates ids", () => {
			const original = createChoice("Macro", "Mac") as IMacroChoice;
			original.macro.commands.push({
				id: "cmd-1",
				name: "Cmd",
			} as unknown as IMacroChoice["macro"]["commands"][number]);
			const originalMacroId = original.macro.id;
			const originalCmdId = original.macro.commands[0].id;

			const copy = duplicateChoice(original) as IMacroChoice;

			// Deep clone: the macro objects must be distinct references.
			expect(copy.macro).not.toBe(original.macro);
			expect(copy.macro.commands).not.toBe(original.macro.commands);
			expect(copy.macro.commands[0]).not.toBe(original.macro.commands[0]);
			// Ids regenerated.
			expect(copy.macro.id).not.toBe(originalMacroId);
			expect(copy.macro.commands[0].id).not.toBe(originalCmdId);
			// Command name preserved.
			expect(copy.macro.commands[0].name).toBe("Cmd");
			// Mutating the copy does not affect the original.
			copy.macro.commands[0].name = "Changed";
			expect(original.macro.commands[0].name).toBe("Cmd");
		});

		it("recursively duplicates nested Multi choices and preserves placeholder/collapsed", () => {
			const inner = createChoice("Template", "Inner");
			const nestedMulti = createChoice("Multi", "Nested") as IMultiChoice;
			const innerChild = createChoice("Capture", "Child");
			nestedMulti.choices = [innerChild];

			const root = createChoice("Multi", "Root") as IMultiChoice;
			root.choices = [inner, nestedMulti];
			root.placeholder = "ph";
			root.collapsed = true;

			const copy = duplicateChoice(root) as IMultiChoice;

			expect(copy.name).toBe("Root (copy)");
			expect(copy.placeholder).toBe("ph");
			expect(copy.collapsed).toBe(true);
			expect(copy.choices).toHaveLength(2);
			expect(copy.choices[0].name).toBe("Inner (copy)");
			expect(copy.choices[1].name).toBe("Nested (copy)");

			const copiedNested = copy.choices[1] as IMultiChoice;
			expect(copiedNested.choices).toHaveLength(1);
			expect(copiedNested.choices[0].name).toBe("Child (copy)");

			// New ids throughout — distinct from the originals.
			expect(copy.id).not.toBe(root.id);
			expect(copy.choices[0].id).not.toBe(inner.id);
			expect(copiedNested.choices[0].id).not.toBe(innerChild.id);
		});
	});

	describe("getChoiceBuilder", () => {
		it("returns a TemplateChoiceBuilder for Template choices", () => {
			mocks.templateBuilder.mockReturnValue(Promise.resolve(undefined));
			const choice = createChoice("Template", "T");
			const plugin = {} as unknown as QuickAdd;
			const builder = getChoiceBuilder(choice, fakeApp, plugin);
			expect(builder).toBeDefined();
			expect(mocks.templateBuilder).toHaveBeenCalledWith(
				fakeApp,
				choice,
				plugin,
			);
		});

		it("returns a CaptureChoiceBuilder for Capture choices", () => {
			mocks.captureBuilder.mockReturnValue(Promise.resolve(undefined));
			const choice = createChoice("Capture", "C");
			const plugin = {} as unknown as QuickAdd;
			const builder = getChoiceBuilder(choice, fakeApp, plugin);
			expect(builder).toBeDefined();
			expect(mocks.captureBuilder).toHaveBeenCalledWith(
				fakeApp,
				choice,
				plugin,
			);
		});

		it("returns a MacroBuilder for Macro choices and passes the store's choices", () => {
			mocks.macroBuilder.mockReturnValue(Promise.resolve(undefined));
			const storeChoice = createChoice("Template", "Stored");
			mocks.storeChoices = [storeChoice];
			const choice = createChoice("Macro", "M");
			const plugin = {} as unknown as QuickAdd;
			const builder = getChoiceBuilder(choice, fakeApp, plugin);
			expect(builder).toBeDefined();
			expect(mocks.macroBuilder).toHaveBeenCalledWith(
				fakeApp,
				plugin,
				choice,
				[storeChoice],
			);
		});

		it("returns undefined for Multi choices", () => {
			const choice = createChoice("Multi", "Mu");
			const plugin = {} as unknown as QuickAdd;
			const builder = getChoiceBuilder(choice, fakeApp, plugin);
			expect(builder).toBeUndefined();
		});
	});

	describe("deleteChoiceWithConfirmation", () => {
		it("returns the user's confirmation result (true)", async () => {
			mocks.yesNoPrompt.mockResolvedValue(true);
			const choice = createChoice("Template", "Del");
			const result = await deleteChoiceWithConfirmation(choice, fakeApp);
			expect(result).toBe(true);
			expect(mocks.yesNoPrompt).toHaveBeenCalledTimes(1);
		});

		it("returns the user's confirmation result (false)", async () => {
			mocks.yesNoPrompt.mockResolvedValue(false);
			const choice = createChoice("Template", "Del");
			const result = await deleteChoiceWithConfirmation(choice, fakeApp);
			expect(result).toBe(false);
		});

		it("mentions the number of nested choices for a Multi choice", async () => {
			mocks.yesNoPrompt.mockResolvedValue(true);
			const multi = createChoice("Multi", "Group") as IMultiChoice;
			multi.choices = [
				createChoice("Template", "a"),
				createChoice("Template", "b"),
			];
			await deleteChoiceWithConfirmation(multi, fakeApp);
			const message = mocks.yesNoPrompt.mock.calls[0][2] as string;
			expect(message).toContain("Group");
			expect(message).toContain("(2)");
			expect(message).toContain("choices inside it");
		});

		it("warns about macro commands for a Macro choice", async () => {
			mocks.yesNoPrompt.mockResolvedValue(true);
			const macro = createChoice("Macro", "MyMacro");
			await deleteChoiceWithConfirmation(macro, fakeApp);
			const message = mocks.yesNoPrompt.mock.calls[0][2] as string;
			expect(message).toContain("MyMacro");
			expect(message).toContain("macro commands");
		});

		it("does not include Multi/Macro warnings for a plain Template choice", async () => {
			mocks.yesNoPrompt.mockResolvedValue(true);
			const choice = createChoice("Template", "Plain");
			await deleteChoiceWithConfirmation(choice, fakeApp);
			const message = mocks.yesNoPrompt.mock.calls[0][2] as string;
			expect(message).not.toContain("choices inside it");
			expect(message).not.toContain("macro commands");
		});
	});

	describe("configureChoice", () => {
		it("opens MultiChoiceSettingsModal for Multi choices and returns its result", async () => {
			const updated = createChoice("Multi", "Updated");
			mocks.multiModal.mockReturnValue(Promise.resolve(updated));
			const choice = createChoice("Multi", "Group");
			const plugin = {} as unknown as QuickAdd;
			const result = await configureChoice(choice, fakeApp, plugin);
			expect(result).toBe(updated);
			expect(mocks.multiModal).toHaveBeenCalledWith(fakeApp, choice);
		});

		it("returns undefined when the Multi modal rejects", async () => {
			mocks.multiModal.mockReturnValue(Promise.reject(new Error("closed")));
			const choice = createChoice("Multi", "Group");
			const plugin = {} as unknown as QuickAdd;
			const result = await configureChoice(choice, fakeApp, plugin);
			expect(result).toBeUndefined();
		});

		it("delegates to the builder for non-Multi choices and returns its result", async () => {
			const updated = createChoice("Template", "Edited");
			mocks.templateBuilder.mockReturnValue(Promise.resolve(updated));
			const choice = createChoice("Template", "T");
			const plugin = {} as unknown as QuickAdd;
			const result = await configureChoice(choice, fakeApp, plugin);
			expect(result).toBe(updated);
		});

		it("propagates a rejected builder waitForClose for non-Multi choices", async () => {
			mocks.captureBuilder.mockReturnValue(
				Promise.reject(new Error("builder failed")),
			);
			const choice = createChoice("Capture", "C");
			const plugin = {} as unknown as QuickAdd;
			await expect(
				configureChoice(choice, fakeApp, plugin),
			).rejects.toThrow("builder failed");
		});
	});

	describe("createToggleCommandChoice", () => {
		it("flips command from false to true without mutating the original", () => {
			const choice = createChoice("Template", "T");
			expect(choice.command).toBe(false);
			const toggled = createToggleCommandChoice(choice);
			expect(toggled.command).toBe(true);
			expect(choice.command).toBe(false);
			expect(toggled).not.toBe(choice);
		});

		it("flips command from true to false", () => {
			const choice = createChoice("Template", "T");
			choice.command = true;
			const toggled = createToggleCommandChoice(choice);
			expect(toggled.command).toBe(false);
		});

		it("preserves all other properties", () => {
			const choice = createChoice("Capture", "C");
			const toggled = createToggleCommandChoice(choice);
			expect(toggled.id).toBe(choice.id);
			expect(toggled.name).toBe(choice.name);
			expect(toggled.type).toBe(choice.type);
		});
	});

	describe("toggleShareMenuById", () => {
		it("flips undefined -> true on the matching top-level choice, immutably", () => {
			const a = createChoice("Macro", "A");
			const b = createChoice("Capture", "B");
			const result = toggleShareMenuById([a, b], a.id);
			expect(result[0].showInShareMenu).toBe(true);
			expect(result[1].showInShareMenu).toBeUndefined();
			expect(a.showInShareMenu).toBeUndefined(); // original untouched
			expect(result[0]).not.toBe(a);
		});

		it("flips true -> false and leaves siblings alone", () => {
			const a = createChoice("Template", "A");
			a.showInShareMenu = true;
			const b = createChoice("Template", "B");
			const [na, nb] = toggleShareMenuById([a, b], a.id);
			expect(na.showInShareMenu).toBe(false);
			expect(nb.showInShareMenu).toBeUndefined();
		});

		it("flips a nested choice inside a Multi", () => {
			const nested = createChoice("Capture", "Nested");
			const folder = createChoice("Multi", "Folder") as IMultiChoice;
			folder.choices = [nested];
			const result = toggleShareMenuById([folder], nested.id) as IMultiChoice[];
			expect(result[0].choices[0].showInShareMenu).toBe(true);
		});

		// Regression guard for the filtered-view clone data-loss bug: toggling a
		// Multi must NEVER drop its children, even if the passed tree node looks
		// like a folder. We flip the flag by id and keep every child intact.
		it("preserves a folder's children when toggling the folder itself", () => {
			const child1 = createChoice("Capture", "Keep 1");
			const child2 = createChoice("Capture", "Keep 2");
			const folder = createChoice("Multi", "Folder") as IMultiChoice;
			folder.choices = [child1, child2];

			const [updated] = toggleShareMenuById([folder], folder.id) as IMultiChoice[];

			expect(updated.showInShareMenu).toBe(true);
			expect(updated.choices.map((c) => c.id)).toEqual([child1.id, child2.id]);
		});

		it("returns choices unchanged when the id is not found", () => {
			const a = createChoice("Template", "A");
			const result = toggleShareMenuById([a], "does-not-exist");
			expect(result[0].showInShareMenu).toBeUndefined();
		});
	});

	describe("CommandRegistry", () => {
		it("enableCommand adds the command via the plugin", () => {
			const addCommandForChoice = vi.fn();
			const removeCommandForChoice = vi.fn();
			const plugin = {
				addCommandForChoice,
				removeCommandForChoice,
			} as unknown as QuickAdd;
			const registry = new CommandRegistry(plugin);
			const choice = createChoice("Template", "T");
			registry.enableCommand(choice);
			expect(addCommandForChoice).toHaveBeenCalledWith(choice);
			expect(removeCommandForChoice).not.toHaveBeenCalled();
		});

		it("disableCommand removes the command via the plugin", () => {
			const addCommandForChoice = vi.fn();
			const removeCommandForChoice = vi.fn();
			const plugin = {
				addCommandForChoice,
				removeCommandForChoice,
			} as unknown as QuickAdd;
			const registry = new CommandRegistry(plugin);
			const choice = createChoice("Template", "T");
			registry.disableCommand(choice);
			expect(removeCommandForChoice).toHaveBeenCalledWith(choice);
			expect(addCommandForChoice).not.toHaveBeenCalled();
		});

		it("updateCommand removes the old choice then adds the new one in order", () => {
			const calls: string[] = [];
			const addCommandForChoice = vi.fn(() => calls.push("add"));
			const removeCommandForChoice = vi.fn(() => calls.push("remove"));
			const plugin = {
				addCommandForChoice,
				removeCommandForChoice,
			} as unknown as QuickAdd;
			const registry = new CommandRegistry(plugin);
			const oldChoice = createChoice("Template", "Old");
			const newChoice = createChoice("Template", "New");
			registry.updateCommand(oldChoice, newChoice);
			expect(removeCommandForChoice).toHaveBeenCalledWith(oldChoice);
			expect(addCommandForChoice).toHaveBeenCalledWith(newChoice);
			expect(calls).toEqual(["remove", "add"]);
		});
	});

	describe("moveChoice", () => {
		const makeMulti = (name: string, children: IChoice[] = []) => {
			const m = createChoice("Multi", name) as IMultiChoice;
			m.choices = children;
			return m;
		};

		it("returns the input unchanged when ids are empty", () => {
			const root = [createChoice("Template", "A")];
			expect(moveChoice(root, "", "x")).toBe(root);
			expect(moveChoice(root, "x", "")).toBe(root);
		});

		it("returns the input unchanged when the moving choice does not exist", () => {
			const target = makeMulti("Group");
			const root = [target];
			expect(moveChoice(root, "missing", target.id)).toBe(root);
		});

		it("returns the input unchanged when the target does not exist", () => {
			const moving = createChoice("Template", "A");
			const root = [moving];
			expect(moveChoice(root, moving.id, "missing")).toBe(root);
		});

		it("returns the input unchanged when the target is not a Multi", () => {
			const moving = createChoice("Template", "A");
			const target = createChoice("Template", "B");
			const root = [moving, target];
			expect(moveChoice(root, moving.id, target.id)).toBe(root);
		});

		it("moves a top-level choice into a Multi at the end of its list", () => {
			const moving = createChoice("Template", "A");
			const target = makeMulti("Group", [createChoice("Template", "Existing")]);
			const root = [moving, target];

			const result = moveChoice(root, moving.id, target.id);

			// Immutability: a new array is returned.
			expect(result).not.toBe(root);
			// Moving choice removed from the top level.
			expect(result.find((c) => c.id === moving.id)).toBeUndefined();
			// Now appended at the end of the target's children.
			const newTarget = result.find(
				(c) => c.id === target.id,
			) as IMultiChoice;
			expect(newTarget.choices).toHaveLength(2);
			expect(newTarget.choices[1].id).toBe(moving.id);
			expect(newTarget.choices[0].name).toBe("Existing");
		});

		it("does not mutate the original choices array", () => {
			const moving = createChoice("Template", "A");
			const target = makeMulti("Group");
			const root = [moving, target];

			moveChoice(root, moving.id, target.id);

			expect(root).toHaveLength(2);
			expect((target as IMultiChoice).choices).toHaveLength(0);
		});

		it("moves a choice out of one Multi into another", () => {
			const moving = createChoice("Template", "A");
			const sourceMulti = makeMulti("Source", [moving]);
			const destMulti = makeMulti("Dest");
			const root = [sourceMulti, destMulti];

			const result = moveChoice(root, moving.id, destMulti.id);

			const newSource = result.find(
				(c) => c.id === sourceMulti.id,
			) as IMultiChoice;
			const newDest = result.find(
				(c) => c.id === destMulti.id,
			) as IMultiChoice;
			expect(newSource.choices).toHaveLength(0);
			expect(newDest.choices).toHaveLength(1);
			expect(newDest.choices[0].id).toBe(moving.id);
		});

		it("prevents moving a Multi into itself", () => {
			const multi = makeMulti("Group", [createChoice("Template", "A")]);
			const root = [multi];
			expect(moveChoice(root, multi.id, multi.id)).toBe(root);
		});

		it("prevents moving a Multi into one of its descendants (cycle)", () => {
			const child = makeMulti("Child");
			const parent = makeMulti("Parent", [child]);
			const root = [parent];
			// Trying to move parent into its descendant child must be a no-op.
			expect(moveChoice(root, parent.id, child.id)).toBe(root);
		});

		it("allows moving a non-Multi into a nested Multi", () => {
			const moving = createChoice("Template", "Leaf");
			const inner = makeMulti("Inner");
			const outer = makeMulti("Outer", [inner]);
			const root = [moving, outer];

			const result = moveChoice(root, moving.id, inner.id);

			expect(result.find((c) => c.id === moving.id)).toBeUndefined();
			const newOuter = result.find(
				(c) => c.id === outer.id,
			) as IMultiChoice;
			const newInner = newOuter.choices[0] as IMultiChoice;
			expect(newInner.choices).toHaveLength(1);
			expect(newInner.choices[0].id).toBe(moving.id);
		});
	});
});
