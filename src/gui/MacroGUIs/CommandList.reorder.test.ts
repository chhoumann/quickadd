import { describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { App } from "obsidian";

// CommandList transitively imports src/main (choice builders, macroHelpers), which
// pulls obsidian-dataview's CJS require('obsidian'); mock it as the rest of the suite does.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { mountComponent } from "../svelte/mountComponent";
import CommandList from "./CommandList.svelte";
import { createCommandListProps } from "./commandListProps.svelte";
import { WaitCommand } from "../../types/macros/QuickCommands/WaitCommand";
import { ObsidianCommand } from "../../types/macros/ObsidianCommand";
import type { ICommand } from "../../types/macros/ICommand";

const makeCommands = (): ICommand[] => [
	new ObsidianCommand("Alpha", "a"),
	new WaitCommand(100),
	new ObsidianCommand("Gamma", "g"),
];

const makeProps = (commands: ICommand[]) =>
	createCommandListProps({
		commands,
		app: new App() as never,
		plugin: {} as never,
		deleteCommand: vi.fn(),
		saveCommands: vi.fn(),
	});

describe("CommandList", () => {
	it("renders every command without vanishing", () => {
		const target = document.createElement("div");
		document.body.appendChild(target);

		const handle = mountComponent(target, CommandList, makeProps(makeCommands()));
		flushSync();

		expect(target.querySelectorAll(".quickAddCommandListItem")).toHaveLength(3);

		handle.destroy();
		target.remove();
	});

	it("re-renders when the host pushes a new commands array (updateCommandList bridge replacement)", () => {
		const target = document.createElement("div");
		document.body.appendChild(target);

		const props = makeProps(makeCommands());
		const handle = mountComponent(target, CommandList, props);
		flushSync();
		expect(target.querySelectorAll(".quickAddCommandListItem")).toHaveLength(3);

		// Host adds a command by mutating the reactive $state props bag.
		props.commands = [...props.commands, new ObsidianCommand("Delta", "d")];
		flushSync();
		expect(target.querySelectorAll(".quickAddCommandListItem")).toHaveLength(4);

		handle.destroy();
		target.remove();
	});
});
