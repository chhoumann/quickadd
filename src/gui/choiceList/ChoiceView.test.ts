import { describe, expect, it, vi } from "vitest";

// CommandList/ChoiceListItem transitively reach the formatter/engine graph, which
// pulls obsidian-dataview's CJS `require('obsidian')`; mock it like the rest of
// the component suite does.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import { fireEvent, render } from "@testing-library/svelte";
import ChoiceView from "./ChoiceView.svelte";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { Plain } from "../svelte/persist.svelte";

// A Macro choice whose macro holds a Conditional command with a populated Then
// branch — mirrors the on-disk shape the local obsidian-e2e test seeds. Built as
// a plain object (the persisted representation) cast to IChoice.
const conditionalMacroChoice = (): IChoice =>
	({
		id: "cond-macro",
		name: "QA Conditional Macro",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: "cond-macro-macro",
			name: "QA Conditional Macro",
			commands: [
				{
					id: "cond-1",
					name: "If condition",
					type: "Conditional",
					condition: {
						mode: "variable",
						variableName: "",
						operator: "isTruthy",
						valueType: "string",
					},
					thenCommands: [
						{ id: "wait-1", name: "Wait", type: "Wait", time: 100 },
					],
					elseCommands: [],
				},
			],
		},
	}) as unknown as IChoice;

const findConditional = (choices: Plain<IChoice[]>) => {
	const macro = choices.find((c) => c.id === "cond-macro") as
		| undefined
		| { macro: { commands: Array<{ id: string; thenCommands?: unknown[] }> } };
	return macro?.macro.commands.find((c) => c.id === "cond-1");
};

const renderChoiceView = (
	choices: IChoice[],
	saveChoices: (next: Plain<IChoice[]>) => void = vi.fn(),
) =>
	render(ChoiceView, {
		props: {
			app: new App() as never,
			// CommandRegistry only touches the plugin lazily (on command toggle),
			// which this test never triggers, so an empty stub is enough.
			plugin: {} as unknown as QuickAdd,
			choices,
			saveChoices,
		},
	});

describe("ChoiceView", () => {
	// The headline goal of #1249: ChoiceView's import graph no longer has the
	// circular dependency that threw `Class extends value undefined`, so it can be
	// mounted in a CI vitest component test at all.
	it("mounts in vitest without the circular-import crash", () => {
		const { getByLabelText, getByText } = renderChoiceView([
			conditionalMacroChoice(),
		]);

		// Renders the seeded macro choice row (aria-label = `Configure <name>`).
		expect(
			getByLabelText("Configure QA Conditional Macro"),
		).toBeInTheDocument();
		// And the view chrome that proves the full subtree rendered.
		expect(getByText("Add Choice")).toBeInTheDocument();
	});

	// Complements the local obsidian-e2e conditional-branch-persistence test in CI:
	// drives ChoiceView's real save path and asserts the conditional Then-branch
	// data survives the snapshot persistence boundary intact and plain.
	it("persists conditional Then-branch data through saveChoices as a plain snapshot", async () => {
		const saveChoices =
			vi.fn<(next: Plain<IChoice[]>) => void>();
		const { getByPlaceholderText, getByText } = renderChoiceView(
			[conditionalMacroChoice()],
			saveChoices,
		);

		// Drive the actual UI: name a new choice and add it -> ChoiceView.save().
		await fireEvent.input(getByPlaceholderText("Name"), {
			target: { value: "Second choice" },
		});
		await fireEvent.click(getByText("Add Choice"));

		await vi.waitFor(() => expect(saveChoices).toHaveBeenCalledTimes(1));

		const saved = saveChoices.mock.calls[0][0];
		// The new choice was appended...
		expect(saved.map((c) => c.name)).toEqual([
			"QA Conditional Macro",
			"Second choice",
		]);
		// ...and the pre-existing conditional's Then branch survives with full nested
		// fidelity (not just length) — the exact data-loss the e2e test guards against.
		const cond = findConditional(saved);
		expect(cond?.thenCommands).toEqual([
			{ id: "wait-1", name: "Wait", type: "Wait", time: 100 },
		]);
		// Persisted payload is a plain, JSON-serializable snapshot (no $state Proxy).
		expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
	});
});
