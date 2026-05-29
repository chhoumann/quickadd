import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";

// StandardCommand -> getCommandDisplayName -> src/main pulls obsidian-dataview's
// CJS require('obsidian'); mock it as the rest of the suite does.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import StandardCommand from "./StandardCommand.svelte";
import WaitCommand from "./WaitCommand.svelte";
import ConditionalCommand from "./ConditionalCommand.svelte";
import { WaitCommand as WaitCommandModel } from "../../../types/macros/QuickCommands/WaitCommand";
import { ObsidianCommand } from "../../../types/macros/ObsidianCommand";
import { ConditionalCommand as ConditionalCommandModel } from "../../../types/macros/Conditional/ConditionalCommand";

const noop = () => {};

describe("StandardCommand", () => {
	it("fires onDeleteCommand with the command id when delete is clicked", async () => {
		const command = new ObsidianCommand("My Command", "obsidian-cmd");
		const onDeleteCommand = vi.fn();
		const { container } = render(StandardCommand, {
			props: { command, startDrag: noop, dragDisabled: true, onDeleteCommand },
		});
		const deleteBtn = container.querySelector(".clickable") as HTMLElement;
		await fireEvent.click(deleteBtn);
		expect(onDeleteCommand).toHaveBeenCalledWith(command.id);
	});
});

describe("WaitCommand", () => {
	it("fires onUpdateCommand with the edited time (persistence path)", async () => {
		const command = new WaitCommandModel(100);
		const onUpdateCommand = vi.fn();
		const { container } = render(WaitCommand, {
			props: {
				command,
				startDrag: noop,
				dragDisabled: true,
				onDeleteCommand: noop,
				onUpdateCommand,
			},
		});
		const input = container.querySelector("input") as HTMLInputElement;
		await fireEvent.input(input, { target: { value: "250" } });
		expect(onUpdateCommand).toHaveBeenCalledWith(
			expect.objectContaining({ id: command.id, time: 250 }),
		);
	});
});

describe("ConditionalCommand", () => {
	it("routes each action button to the matching callback", async () => {
		const command = new ConditionalCommandModel();
		const onConfigureCondition = vi.fn();
		const onEditThenBranch = vi.fn();
		const onEditElseBranch = vi.fn();
		const onDeleteCommand = vi.fn();
		const { getByLabelText } = render(ConditionalCommand, {
			props: {
				command,
				startDrag: noop,
				dragDisabled: true,
				onConfigureCondition,
				onEditThenBranch,
				onEditElseBranch,
				onDeleteCommand,
			},
		});

		await fireEvent.click(getByLabelText("Edit condition"));
		expect(onConfigureCondition).toHaveBeenCalledWith(command);

		await fireEvent.click(getByLabelText("Edit then branch"));
		expect(onEditThenBranch).toHaveBeenCalledWith(command);

		await fireEvent.click(getByLabelText("Edit else branch"));
		expect(onEditElseBranch).toHaveBeenCalledWith(command);

		await fireEvent.click(getByLabelText("Delete command"));
		expect(onDeleteCommand).toHaveBeenCalledWith(command.id);
	});
});
