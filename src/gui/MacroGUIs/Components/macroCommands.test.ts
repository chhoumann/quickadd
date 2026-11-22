// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";

import CommandRow from "./CommandRow.svelte";
import WaitCommand from "./WaitCommand.svelte";
import ConditionalCommand from "./ConditionalCommand.svelte";
import { WaitCommand as WaitCommandModel } from "../../../types/macros/QuickCommands/WaitCommand";
import { ObsidianCommand } from "../../../types/macros/ObsidianCommand";
import { ConditionalCommand as ConditionalCommandModel } from "../../../types/macros/Conditional/ConditionalCommand";

const noop = () => {};

describe("CommandRow", () => {
	it("fires onDeleteCommand with the command id when delete is clicked", async () => {
		const command = new ObsidianCommand("My Command", "obsidian-cmd");
		const onDeleteCommand = vi.fn();
		const { getByLabelText } = render(CommandRow, {
			props: { command, startDrag: noop, dragDisabled: true, onDeleteCommand },
		});
		await fireEvent.click(getByLabelText("Delete My Command"));
		expect(onDeleteCommand).toHaveBeenCalledWith(command.id);
	});

	it("shows the configure button only for a step with something to configure", async () => {
		const command = new ObsidianCommand("My Command", "obsidian-cmd");
		const plain = render(CommandRow, {
			props: { command, startDrag: noop, dragDisabled: true, onDeleteCommand: noop },
		});
		expect(plain.queryByLabelText("Configure My Command")).toBeNull();
		plain.unmount();

		const onConfigure = vi.fn();
		const { getByLabelText } = render(CommandRow, {
			props: { command, startDrag: noop, dragDisabled: true, onDeleteCommand: noop, onConfigure },
		});
		await fireEvent.click(getByLabelText("Configure My Command"));
		expect(onConfigure).toHaveBeenCalledOnce();
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

		// The edit labels include the condition SUMMARY so multiple conditional rows
		// are distinguishable to screen readers. A freshly-added conditional has the
		// generic default name "If condition" (it becomes "If <summary>" only once the
		// condition is saved), so the summary is the reliable per-row identifier.
		// A default condition (variable mode, empty name, isTruthy) summarizes as
		// "(missing variable) is truthy".
		await fireEvent.click(
			getByLabelText("Edit condition for (missing variable) is truthy"),
		);
		expect(onConfigureCondition).toHaveBeenCalledWith(command);

		await fireEvent.click(
			getByLabelText("Edit then branch for (missing variable) is truthy"),
		);
		expect(onEditThenBranch).toHaveBeenCalledWith(command);

		await fireEvent.click(
			getByLabelText("Edit else branch for (missing variable) is truthy"),
		);
		expect(onEditElseBranch).toHaveBeenCalledWith(command);

		// Delete label includes the command identity (a11y, #1250). A default
		// ConditionalCommand is named "If condition".
		await fireEvent.click(getByLabelText("Delete If condition"));
		expect(onDeleteCommand).toHaveBeenCalledWith(command.id);
	});
});
