import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";

// ChoiceListItem -> renderChoiceName/contextMenu reach src/main -> obsidian-dataview.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import ChoiceList from "./ChoiceList.svelte";
import type IChoice from "../../types/choices/IChoice";
import type { ChoiceListActions } from "./choiceListActions";

const normal = (name: string): IChoice =>
	({ id: name, name, type: "Template", command: false }) as unknown as IChoice;
const multi = (name: string, children: IChoice[]): IChoice =>
	({
		id: name,
		name,
		type: "Multi",
		command: false,
		collapsed: false,
		choices: children,
	}) as unknown as IChoice;

function actionsSpy(): ChoiceListActions {
	return {
		onDeleteChoice: vi.fn(),
		onConfigureChoice: vi.fn(),
		onToggleCommand: vi.fn(),
		onToggleShareMenu: vi.fn(),
		onDuplicateChoice: vi.fn(),
		onRenameChoice: vi.fn(),
		onMoveChoice: vi.fn(),
		onReorderChoices: vi.fn(),
		onAddChoice: vi.fn(),
		onToggleCollapsed: vi.fn(),
		onCommitFolder: vi.fn(),
	};
}

const firstArg = (fn: unknown) => (fn as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { id: string };

describe("ChoiceList callback wiring", () => {
	it("routes a flat row's buttons to the shared actions with the right choice", async () => {
		const actions = actionsSpy();
		const choices = [normal("Alpha"), normal("Beta")];
		const { getByLabelText } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});

		await fireEvent.click(getByLabelText("Delete Alpha"));
		expect(actions.onDeleteChoice).toHaveBeenCalledTimes(1);
		expect(firstArg(actions.onDeleteChoice).id).toBe("Alpha");

		await fireEvent.click(getByLabelText("Configure Beta"));
		expect(firstArg(actions.onConfigureChoice).id).toBe("Beta");
	});

	it("threads the SAME actions through the recursion to nested choices", async () => {
		const actions = actionsSpy();
		const nested = normal("Nested");
		const choices = [multi("Group", [nested])];
		const { getByLabelText } = render(ChoiceList, {
			props: { app: new App() as never, roots: choices, choices, actions },
		});

		// The Multi is expanded (collapsed:false), so its nested child renders.
		await fireEvent.click(getByLabelText("Delete Nested"));
		expect(actions.onDeleteChoice).toHaveBeenCalledTimes(1);
		expect(firstArg(actions.onDeleteChoice).id).toBe("Nested");

		// The Multi's own button targets the Multi choice.
		await fireEvent.click(getByLabelText("Duplicate Group"));
		expect(firstArg(actions.onDuplicateChoice).id).toBe("Group");
	});
});
