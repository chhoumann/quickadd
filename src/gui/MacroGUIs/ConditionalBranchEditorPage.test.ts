// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { testApp } from "../../../tests/helpers/settings/modalApp";
import type QuickAdd from "../../main";
import { ConditionalBranchEditorPage } from "./ConditionalBranchEditorPage";

function openPage(commands: unknown) {
	const onSave = vi.fn();
	const page = new ConditionalBranchEditorPage({
		app: testApp(),
		plugin: { settings: { choices: [] } } as unknown as QuickAdd,
		choices: [],
		title: "Then: $mood is truthy",
		commands,
		conditionalHandlers: {},
		onSave,
	});
	page.display();
	return { page, onSave };
}

const wait = { id: "w1", name: "Wait", type: "Wait", time: 100 };

describe("ConditionalBranchEditorPage", () => {
	it("saves nothing when left without an edit", () => {
		const { page, onSave } = openPage([wait]);
		page.hide();
		expect(onSave).toHaveBeenCalledWith(null);
	});

	it("saves the branch's commands once they are edited", () => {
		const { page, onSave } = openPage([wait]);
		page.containerEl.querySelector<HTMLButtonElement>('[aria-label="Add wait command"]')?.click();
		page.hide();
		const saved = onSave.mock.calls[0][0] as Array<{ type: string }>;
		expect(saved.map((command) => command.type)).toEqual(["Wait", "Wait"]);
	});

	it("never replaces a branch it could not read (#1593)", () => {
		const { page, onSave } = openPage("not a list");
		expect(page.containerEl.querySelector(".qaDataUnreadable")).not.toBeNull();
		page.hide();
		expect(onSave).toHaveBeenCalledWith(null);
	});
});
