import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App, DropdownComponent, Notice } from "obsidian";
import { fireEvent } from "@testing-library/svelte";
import { ConditionalCommand } from "../../types/macros/Conditional/ConditionalCommand";
import { ConditionalCommandSettingsModal } from "./ConditionalCommandSettingsModal";

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string }>;
};
const noticeClass = Notice as unknown as NoticeTestClass;

function testApp(): App {
	const app = new App() as App & {
		dom: { appContainerEl: HTMLElement };
		keymap: { pushScope: () => void; popScope: () => void };
	};
	app.dom = { appContainerEl: document.body };
	app.keymap = { pushScope: vi.fn(), popScope: vi.fn() };
	return app;
}

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
