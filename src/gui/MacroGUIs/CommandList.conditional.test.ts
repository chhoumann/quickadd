import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";

import { App } from "obsidian";
import CommandList from "./CommandList.svelte";
import { createCommandListProps } from "./commandListProps.svelte";
import { ConditionalCommand } from "../../types/macros/Conditional/ConditionalCommand";
import { WaitCommand } from "../../types/macros/QuickCommands/WaitCommand";

describe("CommandList conditional branch persistence", () => {
	// Regression: the branch page mutates the command, but the command rendered by
	// CommandList is a $state proxy that does NOT write through to the host's
	// commandsRef. CommandList must persist the mutation via saveCommands(snapshot).
	it("persists then-branch edits through saveCommands as a plain snapshot", async () => {
		const cond = new ConditionalCommand();
		const saveCommands = vi.fn();

		const props = createCommandListProps({
			commands: [cond],
			app: new App() as never,
			plugin: {} as never,
			deleteCommand: vi.fn(),
			saveCommands,
			// Simulate the branch page being left after an edit: it mutates the
			// command, then reports it, synchronously (see BuilderPage).
			onEditThenBranch: (command, onEdited) => {
				command.thenCommands = [new WaitCommand(100)];
				onEdited();
			},
		});

		const { getByLabelText } = render(CommandList, { props });
		// Edit labels include the condition summary (a11y); a default condition
		// summarizes as "(missing variable) is truthy".
		await fireEvent.click(
			getByLabelText("Edit then branch for (missing variable) is truthy"),
		);

		expect(saveCommands).toHaveBeenCalledTimes(1);
		const saved = saveCommands.mock.calls[0][0] as Array<{ thenCommands?: unknown[] }>;
		expect(saved[0].thenCommands).toHaveLength(1);
		// The persisted payload must be a plain snapshot (no $state Proxy artifacts).
		expect(JSON.parse(JSON.stringify(saved))).toEqual(saved);
	});

	it("does NOT save when the branch page is left without an edit", async () => {
		const cond = new ConditionalCommand();
		const saveCommands = vi.fn();

		const props = createCommandListProps({
			commands: [cond],
			app: new App() as never,
			plugin: {} as never,
			deleteCommand: vi.fn(),
			saveCommands,
			// A branch page left unedited never calls onEdited.
			onEditThenBranch: () => {},
		});

		const { getByLabelText } = render(CommandList, { props });
		// Edit labels include the condition summary (a11y); a default condition
		// summarizes as "(missing variable) is truthy".
		await fireEvent.click(
			getByLabelText("Edit then branch for (missing variable) is truthy"),
		);
		await Promise.resolve();

		expect(saveCommands).not.toHaveBeenCalled();
	});
});
