import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { Menu, Platform } from "obsidian";
import AddChoiceControls from "./AddChoiceControls.svelte";
import { PRESETS } from "./presets";

type ShownItem = { title: string; icon: string; clickHandler: ((evt: Partial<MouseEvent>) => void) | null };
// The vitest obsidian stub records the last Menu shown.
const MenuStub = Menu as unknown as { lastShown: { items: ShownItem[] } | null };

describe("New choice menu", () => {
	afterEach(() => {
		Platform.isPhone = false;
	});

	const openMenu = async (props: Record<string, unknown> = {}) => {
		const onAddChoice = vi.fn();
		const onAddFolder = vi.fn();
		const { getByLabelText } = render(AddChoiceControls, { props: { onAddChoice, onAddFolder, ...props } });
		await fireEvent.click(getByLabelText(props.targetFolderName ? `Add choice to ${props.targetFolderName}` : "New choice"));
		return { items: MenuStub.lastShown?.items ?? [], onAddChoice, onAddFolder, getByLabelText };
	};

	it("offers every preset with its description on desktop", async () => {
		const { items } = await openMenu();
		expect(items.map((item) => item.title)).toEqual(
			PRESETS.map((preset) => `${preset.label} - ${preset.description}`),
		);
		expect(items.map((item) => item.icon)).toEqual(PRESETS.map((preset) => preset.iconId));
	});

	// A phone's menu rows are one ellipsized line, which cut the descriptions mid-word.
	it("names only the preset on a phone", async () => {
		Platform.isPhone = true;
		const { items } = await openMenu();
		expect(items.map((item) => item.title)).toEqual(PRESETS.map((preset) => preset.label));
	});

	it("adds the picked preset into the target folder and opens the builder", async () => {
		const { items, onAddChoice } = await openMenu({ targetFolderId: "f1", targetFolderName: "Daily", compact: true });
		items[0].clickHandler?.({ altKey: false });
		expect(onAddChoice).toHaveBeenCalledWith(PRESETS[0], "f1", false);
	});

	it("scaffolds without the builder on Alt-click", async () => {
		const { items, onAddChoice } = await openMenu();
		items[2].clickHandler?.({ altKey: true });
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
