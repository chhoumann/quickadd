// @vitest-environment jsdom
import { testApp } from "../../../tests/helpers/settings/modalApp";
import { collectUnhandledRejections } from "../../../tests/helpers/unhandledRejections";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DropdownComponent, Notice, TFile } from "obsidian";
import { fireEvent } from "@testing-library/svelte";
import { ConditionalCommand } from "../../types/macros/Conditional/ConditionalCommand";
import { ConditionalCommandSettingsModal } from "./ConditionalCommandSettingsModal";
import InputSuggester from "../InputSuggester/inputSuggester";
import { promptCancelled } from "../../errors/UserCancelError";
import { log } from "../../logger/logManager";

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string }>;
};
const noticeClass = Notice as unknown as NoticeTestClass;


function getButton(
	modal: ConditionalCommandSettingsModal,
	text: string
): HTMLButtonElement {
	const button = Array.from(
		modal.containerEl.querySelectorAll<HTMLButtonElement>("button")
	).find((candidate) => candidate.textContent === text);
	if (!button) throw new Error(`${text} button not found`);
	return button;
}

describe("ConditionalCommandSettingsModal save validation", () => {
	beforeAll(() => {
		const modalProto = Object.getPrototypeOf(
			ConditionalCommandSettingsModal.prototype
		) as { onClose?: () => void };
		modalProto.onClose ??= function onClose() {};

		// The test obsidian stub's DropdownComponent lacks addOptions; back-fill it
		// so the modal's operator dropdown can render (harness gap, not a code bug).
		const dropdownProto = DropdownComponent.prototype as unknown as {
			addOptions?: (options: Record<string, string>) => unknown;
			addOption: (value: string, text: string) => unknown;
		};
		dropdownProto.addOptions ??= function addOptions(
			this: { addOption: (value: string, text: string) => unknown },
			options: Record<string, string>
		) {
			for (const [value, text] of Object.entries(options)) {
				this.addOption(value, text);
			}
			return this;
		};
	});

	beforeEach(() => {
		noticeClass.instances.length = 0;
	});

	it("blocks Save and warns when the variable name is empty", async () => {
		const command = new ConditionalCommand({
			condition: {
				mode: "variable",
				variableName: "",
				operator: "isTruthy",
				valueType: "boolean",
			},
		});

		const modal = new ConditionalCommandSettingsModal(testApp(), command);

		let resolved = false;
		void modal.waitForClose.then(() => {
			resolved = true;
		});

		await fireEvent.click(getButton(modal, "Save"));
		// Let any microtasks flush.
		await Promise.resolve();

		// Save must not resolve the modal while the variable name is empty.
		expect(resolved).toBe(false);
		// The command name must NOT have been rewritten to a "missing variable" label.
		expect(command.name).toBe("If condition");
		expect(
			noticeClass.instances.some((n) => /variable name/i.test(n.message))
		).toBe(true);
	});

	it("allows Save once the variable name is filled in", async () => {
		const command = new ConditionalCommand({
			condition: {
				mode: "variable",
				variableName: "status",
				operator: "isTruthy",
				valueType: "boolean",
			},
		});

		const modal = new ConditionalCommandSettingsModal(testApp(), command);
		const result = modal.waitForClose;

		await fireEvent.click(getButton(modal, "Save"));

		await expect(result).resolves.not.toBeNull();
		expect(command.name).toContain("status");
	});
});

/**
 * Obsidian drops a Setting button's click promise, so pressing Escape in the script
 * picker used to be an unhandled rejection that Obsidian's dev:errors listed as
 * `MacroAbortError: Input cancelled by user`.
 */
describe("ConditionalCommandSettingsModal script picker (Browse)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function openModal() {
		const app = testApp();
		const script = new TFile();
		script.path = "Scripts/check.js";
		script.name = "check.js";
		script.basename = "check";
		script.extension = "js";
		app.vault.getFiles = () => [script];

		const command = new ConditionalCommand({
			condition: { mode: "script", scriptPath: "Scripts/old.js" },
		});
		const modal = new ConditionalCommandSettingsModal(app, command);
		return { modal, command, browse: getButton(modal, "Browse") };
	}

	it("stays quiet and keeps the script when the user dismisses the picker", async () => {
		const suggest = vi
			.spyOn(InputSuggester, "Suggest")
			.mockRejectedValue(promptCancelled());
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const { modal, browse } = openModal();

		const unhandled = await collectUnhandledRejections(() => fireEvent.click(browse));

		expect(suggest).toHaveBeenCalledTimes(1);
		expect(unhandled).toEqual([]);
		expect(logError).not.toHaveBeenCalled();
		await fireEvent.click(getButton(modal, "Save"));
		await expect(modal.waitForClose).resolves.toMatchObject({
			condition: { mode: "script", scriptPath: "Scripts/old.js" },
		});
	});

	it("reports a real failure with context instead of leaving it unhandled", async () => {
		vi.spyOn(InputSuggester, "Suggest").mockRejectedValue(new Error("picker broke"));
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const { browse } = openModal();

		const unhandled = await collectUnhandledRejections(() => fireEvent.click(browse));

		expect(unhandled).toEqual([]);
		expect(logError).toHaveBeenCalledTimes(1);
		expect((logError.mock.calls[0][0] as Error).message).toBe(
			"Couldn't select that script: picker broke",
		);
	});
});
