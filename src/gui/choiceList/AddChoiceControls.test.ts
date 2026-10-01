import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { Menu, Platform } from "obsidian";
import AddChoiceControls from "./AddChoiceControls.svelte";
import { DOER_CHOICE_TYPES } from "./choiceTypeMeta";

// The vitest obsidian stub records the last Menu shown.
const MenuStub = Menu as unknown as { lastShown: { items: Array<{ title: string }> } | null };

describe("New choice menu", () => {
	afterEach(() => {
		Platform.isPhone = false;
	});

	const titles = async () => {
		const { getByLabelText } = render(AddChoiceControls, { props: { onAddChoice: vi.fn() } });
		await fireEvent.click(getByLabelText("New choice"));
		return MenuStub.lastShown?.items.map((item) => item.title);
	};

	it("describes each choice type on desktop", async () => {
		const shown = await titles();
		expect(shown).toHaveLength(DOER_CHOICE_TYPES.length);
		DOER_CHOICE_TYPES.forEach((meta, index) => {
			expect(shown?.[index]).toContain(meta.label);
			expect(shown?.[index]).toContain(meta.description);
		});
	});

	// A phone's menu rows are one ellipsized line, which cut the descriptions mid-word.
	it("names only the choice type on a phone", async () => {
		Platform.isPhone = true;
		expect(await titles()).toEqual(["Template", "Capture", "Macro"]);
	});
});
