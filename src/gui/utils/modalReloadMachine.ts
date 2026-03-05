import {
	assign,
	createActor,
	createMachine,
	type AnyActorRef,
} from "xstate";

export type ModalReloadState = "idle" | "capturing" | "rendering" | "restoring";

export interface FocusSnapshot {
	settingName: string | null;
	controlTag: "INPUT" | "TEXTAREA" | "SELECT" | "BUTTON";
	inputType?: string;
	selectionStart?: number | null;
	selectionEnd?: number | null;
	placeholder?: string;
	ariaLabel?: string;
	controlIndex: number;
}

export interface ModalUiSnapshot {
	scrollTop: number;
	focus: FocusSnapshot | null;
}

export interface ModalReloadControllerOptions {
	modalEl: HTMLElement;
	contentEl: HTMLElement;
	render: () => void;
	onTransition?: (
		from: ModalReloadState,
		to: ModalReloadState,
		reason: string,
	) => void;
}

interface ModalReloadContext {
	reason: string;
	snapshot: ModalUiSnapshot | null;
}

type ModalReloadEvent = { type: "REQUEST"; reason: string };

type SupportedControl =
	| HTMLInputElement
	| HTMLTextAreaElement
	| HTMLSelectElement
	| HTMLButtonElement;

const SCROLLABLE_OVERFLOW = new Set(["auto", "scroll", "overlay"]);
const FOCUSABLE_SELECTOR =
	"input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])";

function isSupportedControl(element: Element | null): element is SupportedControl {
	if (!element) return false;
	return (
		element instanceof HTMLInputElement ||
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement ||
		element instanceof HTMLButtonElement
	);
}

function getSettingName(control: SupportedControl): string | null {
	const settingItem = control.closest(".setting-item");
	if (!settingItem) return null;

	const nameEl = settingItem.querySelector(".setting-item-name");
	const name = nameEl?.textContent?.trim();
	return name || null;
}

function getControls(container: ParentNode): SupportedControl[] {
	return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
		(control): control is SupportedControl => isSupportedControl(control),
	);
}

function resolveScrollContainer(
	modalEl: HTMLElement,
	contentEl: HTMLElement,
): HTMLElement {
	const getScrollableScore = (el: HTMLElement): number => {
		const style = window.getComputedStyle(el);
		if (!SCROLLABLE_OVERFLOW.has(style.overflowY)) return 0;
		if (el.scrollHeight <= el.clientHeight) return 1;
		return 2;
	};

	const modalScore = getScrollableScore(modalEl);
	const contentScore = getScrollableScore(contentEl);
	if (modalScore >= contentScore) return modalEl;
	return contentEl;
}

function captureFocusSnapshot(modalEl: HTMLElement): FocusSnapshot | null {
	const activeElement = document.activeElement;
	if (!isSupportedControl(activeElement)) return null;
	if (!modalEl.contains(activeElement)) return null;

	const control = activeElement;
	const settingItem = control.closest(".setting-item");
	const peers = settingItem ? getControls(settingItem) : getControls(modalEl);
	const controlIndex = Math.max(0, peers.indexOf(control));

	const snapshot: FocusSnapshot = {
		settingName: getSettingName(control),
		controlTag: control.tagName as FocusSnapshot["controlTag"],
		inputType:
			control instanceof HTMLInputElement ? control.type || "text" : undefined,
		selectionStart:
			control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
				? control.selectionStart
				: undefined,
		selectionEnd:
			control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
				? control.selectionEnd
				: undefined,
		placeholder:
			control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
				? control.placeholder || undefined
				: undefined,
		ariaLabel: control.getAttribute("aria-label") ?? undefined,
		controlIndex,
	};

	return snapshot;
}

function captureModalUiSnapshot(
	modalEl: HTMLElement,
	contentEl: HTMLElement,
): ModalUiSnapshot {
	const scrollContainer = resolveScrollContainer(modalEl, contentEl);
	return {
		scrollTop: scrollContainer.scrollTop,
		focus: captureFocusSnapshot(modalEl),
	};
}

function matchesFocusSnapshot(
	control: SupportedControl,
	snapshot: FocusSnapshot,
): boolean {
	if (control.tagName !== snapshot.controlTag) return false;

	if (control instanceof HTMLInputElement && snapshot.inputType) {
		if ((control.type || "text") !== snapshot.inputType) {
			return false;
		}
	}

	if (snapshot.placeholder !== undefined) {
		const placeholder =
			control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
				? control.placeholder
				: "";
		if (placeholder !== snapshot.placeholder) return false;
	}

	if (snapshot.ariaLabel !== undefined) {
		if ((control.getAttribute("aria-label") ?? "") !== snapshot.ariaLabel) {
			return false;
		}
	}

	return true;
}

function findBestControlMatch(
	controls: SupportedControl[],
	snapshot: FocusSnapshot,
): SupportedControl | null {
	if (controls.length === 0) return null;

	const indexed = controls[snapshot.controlIndex];
	if (indexed && matchesFocusSnapshot(indexed, snapshot)) {
		return indexed;
	}

	const matchingControl = controls.find((control) =>
		matchesFocusSnapshot(control, snapshot),
	);
	if (matchingControl) return matchingControl;

	if (snapshot.controlIndex < controls.length) {
		return controls[snapshot.controlIndex];
	}

	return controls[0] ?? null;
}

function restoreSelection(
	control: SupportedControl,
	snapshot: FocusSnapshot,
): void {
	if (
		!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)
	) {
		return;
	}
	if (snapshot.selectionStart == null || snapshot.selectionEnd == null) return;

	try {
		control.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
	} catch {
		// Ignore selection restore failures on unsupported input types.
	}
}

function focusControl(control: SupportedControl): void {
	try {
		control.focus({ preventScroll: true });
	} catch {
		control.focus();
	}
}

function restoreFocus(modalEl: HTMLElement, snapshot: FocusSnapshot | null): void {
	if (!snapshot) return;

	const settingItems = Array.from(modalEl.querySelectorAll(".setting-item"));
	const matchingSetting = snapshot.settingName
		? settingItems.find((settingItem) => {
				const name =
					settingItem
						.querySelector(".setting-item-name")
						?.textContent?.trim() ?? "";
				return name === snapshot.settingName;
		  })
		: null;

	let target: SupportedControl | null = null;

	if (matchingSetting) {
		target = findBestControlMatch(getControls(matchingSetting), snapshot);
	}

	if (!target) {
		target = findBestControlMatch(getControls(modalEl), snapshot);
	}

	if (!target) return;

	focusControl(target);
	restoreSelection(target, snapshot);
}

function restoreModalUiSnapshot(
	modalEl: HTMLElement,
	contentEl: HTMLElement,
	snapshot: ModalUiSnapshot | null,
): void {
	if (!snapshot) return;

	restoreFocus(modalEl, snapshot.focus);

	const scrollContainer = resolveScrollContainer(modalEl, contentEl);
	const maxScrollTop = Math.max(
		0,
		scrollContainer.scrollHeight - scrollContainer.clientHeight,
	);
	scrollContainer.scrollTop = Math.min(snapshot.scrollTop, maxScrollTop);
}

export class ModalReloadController {
	private readonly actor: AnyActorRef;
	private readonly options: ModalReloadControllerOptions;
	private processing = false;
	private pendingReason: string | null = null;

	constructor(options: ModalReloadControllerOptions) {
		this.options = options;

		const machine = createMachine({
			types: {} as {
				context: ModalReloadContext;
				events: ModalReloadEvent;
			},
			id: "modalReload",
			initial: "idle",
			context: {
				reason: "",
				snapshot: null,
			},
			states: {
				idle: {
					on: {
						REQUEST: {
							target: "capturing",
							actions: assign({
								reason: ({ event }) => event.reason,
							}),
						},
					},
				},
				capturing: {
					entry: [
						({ context }) => {
							this.options.onTransition?.(
								"idle",
								"capturing",
								context.reason,
							);
						},
						assign({
							snapshot: () =>
								captureModalUiSnapshot(
									this.options.modalEl,
									this.options.contentEl,
								),
						}),
					],
					always: {
						target: "rendering",
					},
				},
				rendering: {
					entry: ({ context }) => {
						this.options.onTransition?.(
							"capturing",
							"rendering",
							context.reason,
						);
						this.options.render();
					},
					always: {
						target: "restoring",
					},
				},
				restoring: {
					entry: ({ context }) => {
						this.options.onTransition?.(
							"rendering",
							"restoring",
							context.reason,
						);
						restoreModalUiSnapshot(
							this.options.modalEl,
							this.options.contentEl,
							context.snapshot,
						);
					},
					always: {
						target: "idle",
						actions: ({ context }) => {
							this.options.onTransition?.(
								"restoring",
								"idle",
								context.reason,
							);
						},
					},
				},
			},
		});

		this.actor = createActor(machine);
		this.actor.start();
	}

	requestReload(reason: string): void {
		if (this.processing) {
			this.pendingReason = reason;
			return;
		}

		this.processing = true;
		try {
			this.actor.send({ type: "REQUEST", reason });
		} finally {
			this.processing = false;
		}

		if (!this.pendingReason) return;
		const pending = this.pendingReason;
		this.pendingReason = null;
		this.requestReload(pending);
	}

	getLastSnapshot(): ModalUiSnapshot | null {
		return this.actor.getSnapshot().context.snapshot;
	}

	destroy(): void {
		this.actor.stop();
	}
}
