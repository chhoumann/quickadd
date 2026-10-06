import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { Menu, Platform } from "obsidian";
import AddChoiceControls from "./AddChoiceControls.svelte";
import { settingsStore } from "../../settingsStore";
import { PRESET_GROUPS, PRESETS } from "./presets";

type ShownItem = {
	title: string;
	icon: string;
	isLabel: boolean;
	section: string;
	clickHandler: ((evt: Partial<MouseEvent>) => void) | null;
};
// The vitest obsidian stub records the last Menu shown.
const MenuStub = Menu as unknown as { lastShown: { items: ShownItem[] } | null };

describe("New choice menu", () => {
	const original = settingsStore.getState().disableOnlineFeatures;
	beforeEach(() => {
		settingsStore.setState((state) => ({ ...state, disableOnlineFeatures: false }));
	});
	afterEach(() => {
		Platform.isPhone = false;
		settingsStore.setState((state) => ({ ...state, disableOnlineFeatures: original }));
	});

	const openMenu = async (props: Record<string, unknown> = {}) => {
		const onAddChoice = vi.fn();
		const onAddFolder = vi.fn();
		const { getByLabelText } = render(AddChoiceControls, { props: { onAddChoice, onAddFolder, ...props } });
		await fireEvent.click(getByLabelText(props.targetFolderName ? `Add choice to ${props.targetFolderName}` : "New choice"));
		const items = MenuStub.lastShown?.items ?? [];
		const presetItems = items.filter((item) => !item.isLabel && item.section !== "packages");
		return { items, presetItems, onAddChoice, onAddFolder, getByLabelText };
	};

	it("groups the presets under their outcome, with descriptions on desktop", async () => {
		const { items } = await openMenu();
		const rows = items.map((item) => (item.isLabel ? `# ${item.title}` : item.title));
		expect(rows).toEqual(
			PRESET_GROUPS.flatMap((group) => [
				`# ${group.label}`,
				...PRESETS.filter((preset) => preset.group === group.id).map(
					(preset) => `${preset.label} - ${preset.description}`,
				),
			]),
		);
		expect(items.filter((item) => !item.isLabel).map((item) => item.icon)).toEqual(PRESETS.map((preset) => preset.iconId));
		// Each group is its own section, so the menu separates them.
		expect(new Set(items.map((item) => item.section))).toEqual(new Set(["add", "create", "automate"]));
	});

	// A phone's menu rows are one ellipsized line, which cut the descriptions mid-word.
	it("names only the preset on a phone", async () => {
		Platform.isPhone = true;
		const { presetItems } = await openMenu();
		expect(presetItems.map((item) => item.title)).toEqual(PRESETS.map((preset) => preset.label));
	});

	it("leaves out Ask AI while online features are off", async () => {
		settingsStore.setState((state) => ({ ...state, disableOnlineFeatures: true }));
		const { presetItems } = await openMenu();
		expect(presetItems.map((item) => item.title)).not.toContain(expect.stringMatching(/^Ask AI/));
		expect(presetItems).toHaveLength(PRESETS.length - 1);
	});

	it("ends with the recipes and package import, in a section of their own", async () => {
		const onBrowseRecipes = vi.fn();
		const onImportPackage = vi.fn();
		const { items } = await openMenu({ onBrowseRecipes, onImportPackage });
		const footer = items.slice(-2);
		expect(footer.map((item) => [item.title, item.section])).toEqual([
			["Browse recipes…", "packages"],
			["Import a package…", "packages"],
		]);
		footer[0].clickHandler?.({});
		expect(onBrowseRecipes).toHaveBeenCalledTimes(1);
		footer[1].clickHandler?.({});
		expect(onImportPackage).toHaveBeenCalledTimes(1);
	});

	it("offers no recipes inside a folder", async () => {
		const { items } = await openMenu({ targetFolderId: "f1", targetFolderName: "Daily", compact: true });
		expect(items.some((item) => item.section === "packages")).toBe(false);
	});

	it("adds the picked preset into the target folder and opens the builder", async () => {
		const { presetItems, onAddChoice } = await openMenu({ targetFolderId: "f1", targetFolderName: "Daily", compact: true });
		presetItems[0].clickHandler?.({ altKey: false });
		expect(onAddChoice).toHaveBeenCalledWith(PRESETS[0], "f1", false);
	});

	it("scaffolds without the builder on Alt-click", async () => {
		const { presetItems, onAddChoice } = await openMenu();
		presetItems[2].clickHandler?.({ altKey: true });
		expect(onAddChoice).toHaveBeenCalledWith(PRESETS[2], undefined, true);
	});

	it("adds a folder from its own button", async () => {
		const onAddFolder = vi.fn();
		const { getByLabelText } = render(AddChoiceControls, {
			props: { onAddChoice: vi.fn(), onAddFolder, targetFolderId: "f1", targetFolderName: "Daily", compact: true },
		});
		await fireEvent.click(getByLabelText("Add folder to Daily"));
		expect(onAddFolder).toHaveBeenCalledWith("f1");
	});
});
