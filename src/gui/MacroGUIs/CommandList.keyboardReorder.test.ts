import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";

// CommandList transitively imports src/main, which pulls obsidian-dataview's CJS
// require('obsidian'); mock it as the rest of the suite does.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App } from "obsidian";
import CommandList from "./CommandList.svelte";
import { createCommandListProps } from "./commandListProps.svelte";
import { ObsidianCommand } from "../../types/macros/ObsidianCommand";
import type { ICommand } from "../../types/macros/ICommand";

const makeProps = (commands: ICommand[], saveCommands = vi.fn()) =>
	createCommandListProps({
		commands,
		app: new App() as never,
		plugin: {} as never,
		deleteCommand: vi.fn(),
		saveCommands,
	});

describe("CommandList keyboard reorder", () => {
	it("ArrowDown on a row's drag handle moves it down and persists the new order", async () => {
		const a = new ObsidianCommand("Alpha", "a");
		const b = new ObsidianCommand("Beta", "b");
		const c = new ObsidianCommand("Gamma", "c");
		const saveCommands = vi.fn();

		const { getByLabelText } = render(CommandList, {
			props: makeProps([a, b, c], saveCommands),
		});

		// Handle labels include the command identity (a11y, #1250).
		await fireEvent.keyDown(getByLabelText("Reorder Alpha"), { key: "ArrowDown" });

		await vi.waitFor(() => expect(saveCommands).toHaveBeenCalledTimes(1));
		const saved = saveCommands.mock.calls[0][0] as ICommand[];
		expect(saved.map((cmd) => cmd.id)).toEqual([b.id, a.id, c.id]);
	});

	it("ArrowUp on the last row moves it up", async () => {
		const a = new ObsidianCommand("Alpha", "a");
		const b = new ObsidianCommand("Beta", "b");
		const c = new ObsidianCommand("Gamma", "c");
		const saveCommands = vi.fn();

		const { getByLabelText } = render(CommandList, {
			props: makeProps([a, b, c], saveCommands),
		});

		await fireEvent.keyDown(getByLabelText("Reorder Gamma"), { key: "ArrowUp" });

		await vi.waitFor(() => expect(saveCommands).toHaveBeenCalledTimes(1));
		expect((saveCommands.mock.calls[0][0] as ICommand[]).map((cmd) => cmd.id)).toEqual([
			a.id,
			c.id,
			b.id,
		]);
	});

	it("clamps at the ends — ArrowUp on the first row is a no-op", async () => {
		const a = new ObsidianCommand("Alpha", "a");
		const b = new ObsidianCommand("Beta", "b");
		const saveCommands = vi.fn();

		const { getByLabelText } = render(CommandList, {
			props: makeProps([a, b], saveCommands),
		});

		await fireEvent.keyDown(getByLabelText("Reorder Alpha"), { key: "ArrowUp" });
		await Promise.resolve();
		expect(saveCommands).not.toHaveBeenCalled();
	});
});
