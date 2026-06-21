import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/svelte";
import WaitCommand from "./WaitCommand.svelte";
import { WaitCommand as WaitCommandModel } from "../../../types/macros/QuickCommands/WaitCommand";

function makeProps(onUpdateCommand: (command: unknown) => void) {
	const command = new WaitCommandModel(100);
	command.id = "wait-1";
	return {
		command,
		startDrag: () => {},
		dragDisabled: true,
		onDeleteCommand: () => {},
		onUpdateCommand,
		onMoveUp: () => {},
		onMoveDown: () => {},
	};
}

describe("WaitCommand duration input", () => {
	it("exposes a non-negative minimum on the duration input", () => {
		const { getByLabelText } = render(WaitCommand, {
			props: makeProps(() => {}),
		});

		const input = getByLabelText(
			"Wait duration in milliseconds"
		) as HTMLInputElement;
		expect(input.getAttribute("min")).toBe("0");
	});

	it("clamps a negative duration to 0", async () => {
		const onUpdateCommand = vi.fn();
		const { getByLabelText } = render(WaitCommand, {
			props: makeProps(onUpdateCommand),
		});

		const input = getByLabelText(
			"Wait duration in milliseconds"
		) as HTMLInputElement;

		await fireEvent.input(input, { target: { value: "-50" } });

		expect(onUpdateCommand).toHaveBeenCalledTimes(1);
		expect(onUpdateCommand.mock.calls[0][0]).toMatchObject({ time: 0 });
	});

	it("keeps a valid positive duration", async () => {
		const onUpdateCommand = vi.fn();
		const { getByLabelText } = render(WaitCommand, {
			props: makeProps(onUpdateCommand),
		});

		const input = getByLabelText(
			"Wait duration in milliseconds"
		) as HTMLInputElement;

		await fireEvent.input(input, { target: { value: "250" } });

		expect(onUpdateCommand.mock.calls[0][0]).toMatchObject({ time: 250 });
	});
});
