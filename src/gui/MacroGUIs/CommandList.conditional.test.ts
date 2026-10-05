import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import { tick } from "svelte";

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

// A step added in this session is a class instance, which $state does not
// proxy, so an in-place edit only shows if the list gets a new object (#2147).
describe("CommandList conditional label after an edit", () => {
	function renderWith(handlers: Partial<Parameters<typeof createCommandListProps>[0]>) {
		const props = createCommandListProps({
			commands: [new ConditionalCommand()],
			app: new App() as never,
			plugin: {} as never,
			deleteCommand: vi.fn(),
			saveCommands: vi.fn(),
			...handlers,
		});
		return render(CommandList, { props });
	}

	it("shows the new condition once its dialog is saved", async () => {
		const { getByLabelText, container } = renderWith({
			onConfigureCondition: (command) => {
				command.condition = { ...command.condition, variableName: "mood" } as typeof command.condition;
				return true;
			},
		});

		await fireEvent.click(getByLabelText("Edit condition for (missing variable) is truthy"));
		await tick();

		expect(container.querySelector(".quickAddCommandLabel")?.textContent).toBe("$mood is truthy");
		expect(container.querySelector(".quickAddCommandDetail")?.textContent).toBe("If mood is truthy then nothing");
		expect(getByLabelText("Edit then branch for $mood is truthy")).toBeTruthy();
	});

	it("says what the new branch does once its page is left", async () => {
		const { getByLabelText, container } = renderWith({
			onEditThenBranch: (command, onEdited) => {
				command.thenCommands = [new WaitCommand(100)];
				onEdited();
			},
		});

		await fireEvent.click(getByLabelText("Edit then branch for (missing variable) is truthy"));
		await tick();

		expect(container.querySelector(".quickAddCommandDetail")?.textContent).toBe(
			"If (missing variable) is truthy then waits 100 ms",
		);
	});
});
