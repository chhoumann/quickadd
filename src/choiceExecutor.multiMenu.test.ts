import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { ChoiceExecutor } from "./choiceExecutor";
import type IChoice from "./types/choices/IChoice";
import type IMultiChoice from "./types/choices/IMultiChoice";

const { showChoiceMenuMock, choiceSuggesterOpenMock } = vi.hoisted(() => ({
	showChoiceMenuMock: vi.fn(),
	choiceSuggesterOpenMock: vi.fn(),
}));

vi.mock("./gui/choiceMenu", () => ({
	showChoiceMenu: showChoiceMenuMock,
}));

vi.mock("./gui/suggesters/choiceSuggester", () => ({
	default: {
		Open: choiceSuggesterOpenMock,
	},
}));

vi.mock("./engine/TemplateChoiceEngine", () => ({
	TemplateChoiceEngine: class {
		run = vi.fn();
	},
}));

vi.mock("./engine/CaptureChoiceEngine", () => ({
	CaptureChoiceEngine: class {
		run = vi.fn();
	},
}));

vi.mock("./engine/MacroChoiceEngine", () => ({
	MacroChoiceEngine: class {
		params = { variables: {} };
		run = vi.fn();
	},
}));

vi.mock("./preflight/runOnePagePreflight", () => ({
	runOnePagePreflight: vi.fn(),
}));

vi.mock("./utilityObsidian", () => ({
	getOpenFileOriginLeaf: vi.fn(() => null),
}));

const child: IChoice = {
	id: "child",
	name: "Child",
	type: "Template",
	command: false,
};

const multi = (overrides: Partial<IMultiChoice> = {}): IMultiChoice => ({
	id: "multi",
	name: "Multi",
	type: "Multi",
	command: false,
	collapsed: false,
	choices: [child],
	...overrides,
});

describe("ChoiceExecutor Multi display modes", () => {
	beforeEach(() => {
		showChoiceMenuMock.mockClear();
		choiceSuggesterOpenMock.mockClear();
	});

	it("opens menu-mode Multi choices with the compact menu", async () => {
		const app = new App();
		const plugin = { app } as never;
		const executor = new ChoiceExecutor(app, plugin);
		const choice = multi({ displayMode: "menu" });

		await executor.execute(choice);

		expect(showChoiceMenuMock).toHaveBeenCalledWith(app, [child], executor);
		expect(choiceSuggesterOpenMock).not.toHaveBeenCalled();
	});

	it("keeps picker mode as the default for existing Multi choices", async () => {
		const app = new App();
		const plugin = { app } as never;
		const executor = new ChoiceExecutor(app, plugin);
		const choice = multi({ placeholder: "Pick one" });

		await executor.execute(choice);

		expect(choiceSuggesterOpenMock).toHaveBeenCalledWith(plugin, [child], {
			choiceExecutor: executor,
			placeholder: "Pick one",
		});
		expect(showChoiceMenuMock).not.toHaveBeenCalled();
	});
});
