import { describe, expect, it } from "vitest";
import { ModalReloadController } from "./modalReloadMachine";

function setScrollableMetrics(
	element: HTMLElement,
	metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
) {
	let { scrollHeight, clientHeight, scrollTop } = metrics;

	Object.defineProperty(element, "scrollHeight", {
		configurable: true,
		get: () => scrollHeight,
	});

	Object.defineProperty(element, "clientHeight", {
		configurable: true,
		get: () => clientHeight,
	});

	Object.defineProperty(element, "scrollTop", {
		configurable: true,
		get: () => scrollTop,
		set: (value: number) => {
			scrollTop = value;
		},
	});

	return {
		setScrollHeight: (value: number) => {
			scrollHeight = value;
		},
		setClientHeight: (value: number) => {
			clientHeight = value;
		},
		getScrollTop: () => scrollTop,
	};
}

function createModalHarness() {
	const modalEl = document.createElement("div");
	modalEl.className = "modal";
	modalEl.style.overflowY = "auto";

	const contentEl = document.createElement("div");
	contentEl.className = "modal-content";
	modalEl.appendChild(contentEl);
	document.body.appendChild(modalEl);

	const metrics = setScrollableMetrics(modalEl, {
		scrollHeight: 1000,
		clientHeight: 400,
		scrollTop: 0,
	});

	return {
		modalEl,
		contentEl,
		metrics,
		destroy: () => {
			modalEl.remove();
		},
	};
}

function renderSettingWithInput(
	contentEl: HTMLElement,
	options: {
		settingName?: string;
		placeholder?: string;
		inputType?: string;
		includeInput?: boolean;
		includeButton?: boolean;
	} = {},
): { input: HTMLInputElement | null; button: HTMLButtonElement | null } {
	const {
		settingName = "Target Setting",
		placeholder = "target-input",
		inputType = "text",
		includeInput = true,
		includeButton = false,
	} = options;

	contentEl.innerHTML = "";

	const setting = document.createElement("div");
	setting.className = "setting-item";

	const info = document.createElement("div");
	info.className = "setting-item-info";

	const name = document.createElement("div");
	name.className = "setting-item-name";
	name.textContent = settingName;
	info.appendChild(name);

	const control = document.createElement("div");
	control.className = "setting-item-control";

	let input: HTMLInputElement | null = null;
	if (includeInput) {
		input = document.createElement("input");
		input.type = inputType;
		input.placeholder = placeholder;
		input.value = "abcdef";
		control.appendChild(input);
	}

	let button: HTMLButtonElement | null = null;
	if (includeButton) {
		button = document.createElement("button");
		button.type = "button";
		button.textContent = "Fallback";
		control.appendChild(button);
	}

	setting.appendChild(info);
	setting.appendChild(control);
	contentEl.appendChild(setting);

	return { input, button };
}

describe("ModalReloadController", () => {
	it("restores modal scroll position and focused input after reload", () => {
		const harness = createModalHarness();
		const transitions: string[] = [];

		const initial = renderSettingWithInput(harness.contentEl, {
			settingName: "Show advanced settings",
			placeholder: "advanced-input",
		});
		expect(initial.input).not.toBeNull();

		initial.input!.focus();
		initial.input!.setSelectionRange(1, 3);
		harness.modalEl.scrollTop = 260;

		let renderedInput: HTMLInputElement | null = null;
		const controller = new ModalReloadController({
			modalEl: harness.modalEl,
			contentEl: harness.contentEl,
			render: () => {
				renderedInput = renderSettingWithInput(harness.contentEl, {
					settingName: "Show advanced settings",
					placeholder: "advanced-input",
				}).input;
			},
			onTransition: (from, to, reason) => {
				transitions.push(`${from}->${to}:${reason}`);
			},
		});

		controller.requestReload("toggle-advanced");

		expect(harness.metrics.getScrollTop()).toBe(260);
		expect(document.activeElement).toBe(renderedInput);
		expect((document.activeElement as HTMLInputElement).selectionStart).toBe(1);
		expect((document.activeElement as HTMLInputElement).selectionEnd).toBe(3);
		expect(transitions).toEqual([
			"idle->capturing:toggle-advanced",
			"capturing->rendering:toggle-advanced",
			"rendering->restoring:toggle-advanced",
			"restoring->idle:toggle-advanced",
		]);

		controller.destroy();
		harness.destroy();
	});

	it("clamps restored scroll position when rendered content becomes shorter", () => {
		const harness = createModalHarness();
		const initial = renderSettingWithInput(harness.contentEl);
		expect(initial.input).not.toBeNull();
		initial.input!.focus();

		harness.modalEl.scrollTop = 550;

		const controller = new ModalReloadController({
			modalEl: harness.modalEl,
			contentEl: harness.contentEl,
			render: () => {
				harness.metrics.setScrollHeight(300);
				harness.metrics.setClientHeight(200);
				renderSettingWithInput(harness.contentEl);
			},
		});

		controller.requestReload("content-shorter");
		expect(harness.metrics.getScrollTop()).toBe(100);

		controller.destroy();
		harness.destroy();
	});

	it("falls back to another control in the same setting when focused control disappears", () => {
		const harness = createModalHarness();
		const initial = renderSettingWithInput(harness.contentEl, {
			settingName: "Model source",
			placeholder: "source-input",
			includeButton: true,
		});
		expect(initial.input).not.toBeNull();
		initial.input!.focus();

		let fallbackButton: HTMLButtonElement | null = null;
		const controller = new ModalReloadController({
			modalEl: harness.modalEl,
			contentEl: harness.contentEl,
			render: () => {
				const rendered = renderSettingWithInput(harness.contentEl, {
					settingName: "Model source",
					includeInput: false,
					includeButton: true,
				});
				fallbackButton = rendered.button;
			},
		});

		controller.requestReload("remove-input");
		expect(document.activeElement).toBe(fallbackButton);

		controller.destroy();
		harness.destroy();
	});

	it("does not throw when no focusable controls exist after reload", () => {
		const harness = createModalHarness();
		const initial = renderSettingWithInput(harness.contentEl, {
			settingName: "Result",
		});
		expect(initial.input).not.toBeNull();
		initial.input!.focus();
		harness.modalEl.scrollTop = 140;

		const controller = new ModalReloadController({
			modalEl: harness.modalEl,
			contentEl: harness.contentEl,
			render: () => {
				harness.contentEl.innerHTML = "<div>No controls</div>";
			},
		});

		expect(() => controller.requestReload("empty-render")).not.toThrow();
		expect(harness.metrics.getScrollTop()).toBe(140);

		controller.destroy();
		harness.destroy();
	});
});
