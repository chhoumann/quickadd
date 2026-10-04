import { afterEach, describe, expect, it, vi } from "vitest";

const { configureChoiceMock, backOutOfBuilderPagesMock } = vi.hoisted(() => ({
	configureChoiceMock: vi.fn(),
	backOutOfBuilderPagesMock: vi.fn(),
}));
vi.mock("../../services/choiceService", async (importOriginal) => ({
	...(await importOriginal<typeof ChoiceServiceModule>()),
	configureChoice: configureChoiceMock,
}));
vi.mock("../ChoiceBuilder/builderPage", async (importOriginal) => ({
	...(await importOriginal<typeof BuilderPageModule>()),
	backOutOfBuilderPages: backOutOfBuilderPagesMock,
}));

import { App } from "obsidian";
import { fireEvent, render } from "@testing-library/svelte";
import type * as BuilderPageModule from "../ChoiceBuilder/builderPage";
import type * as ChoiceServiceModule from "../../services/choiceService";
import type QuickAdd from "../../main";
import { settingsStore } from "../../settingsStore";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import type IChoice from "../../types/choices/IChoice";
import type IMacroChoice from "../../types/choices/IMacroChoice";
import { CommandType } from "../../types/macros/CommandType";
import type { INestedChoiceCommand } from "../../types/macros/QuickCommands/INestedChoiceCommand";
import { newStep } from "../../v3/addStep";
import type { Step } from "../../v3/model";
import type { Plain } from "../svelte/persist.svelte";
import ChoiceView from "./ChoiceView.svelte";

describe("adding a step from a Capture's builder", () => {
	const initialState = settingsStore.getState();

	afterEach(() => {
		settingsStore.setState(initialState, true);
		configureChoiceMock.mockReset();
		backOutOfBuilderPagesMock.mockReset();
	});

	it("saves the Capture as a Macro that runs it first, and opens that", async () => {
		const capture = Object.assign(new CaptureChoice("Log"), { id: "log", captureTo: "log.md", command: true });
		settingsStore.setState({ choices: [JSON.parse(JSON.stringify(capture)) as IChoice] });
		const saveChoices = vi.fn((next: Plain<IChoice[]>) => settingsStore.setState({ choices: next as IChoice[] }));
		const plugin = { addCommandForChoice: vi.fn(), removeCommandForChoice: vi.fn() };

		// The builder adds a step as soon as it opens; the next one is the macro's.
		const step = newStep("runScript");
		configureChoiceMock.mockImplementation(
			(_choice: IChoice, _app: unknown, _plugin: unknown, _onSave: unknown, options?: { onAddStep?: (step: Step) => void }) => {
				if (configureChoiceMock.mock.calls.length === 1) options?.onAddStep?.(step);
				return true;
			},
		);

		const { getByLabelText } = render(ChoiceView, {
			props: {
				app: new App() as never,
				plugin: plugin as unknown as QuickAdd,
				choices: settingsStore.getState().choices,
				saveChoices,
				openAISettings: vi.fn(),
			},
		});
		await fireEvent.click(getByLabelText("Configure Log"));

		const saved = saveChoices.mock.calls.at(-1)?.[0] as IChoice[];
		const macro = saved[0] as IMacroChoice;
		expect(macro).toMatchObject({ id: "log", name: "Log", type: "Macro", command: true });
		expect(macro).not.toHaveProperty("captureTo");
		expect(macro).not.toHaveProperty("format");
		const [nested, script] = macro.macro.commands;
		expect(nested).toMatchObject({ type: CommandType.NestedChoice, name: "Log" });
		expect((nested as INestedChoiceCommand).choice).toMatchObject({ type: "Capture", captureTo: "log.md", command: false });
		expect((nested as INestedChoiceCommand).choice.id).not.toBe("log");
		expect(script).toMatchObject({ id: step.id, type: CommandType.UserScript });

		expect(plugin.removeCommandForChoice).toHaveBeenCalledWith(expect.objectContaining({ id: "log", type: "Capture" }));
		expect(plugin.addCommandForChoice).toHaveBeenCalledWith(expect.objectContaining({ id: "log", type: "Macro" }));
		expect(backOutOfBuilderPagesMock).toHaveBeenCalledTimes(1);
		// The macro builder opens on the Macro, not on the Capture the list showed.
		expect(configureChoiceMock).toHaveBeenCalledTimes(2);
		expect(configureChoiceMock.mock.calls[1][0]).toMatchObject({ id: "log", type: "Macro" });
	});
});
