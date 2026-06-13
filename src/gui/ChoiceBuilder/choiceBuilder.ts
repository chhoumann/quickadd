import { type App, Modal } from "obsidian";
import type { MountHandle } from "../svelte/mountComponent";
import { snapshot } from "../svelte/persist.svelte";
import type IChoice from "../../types/choices/IChoice";

/**
 * Thin Modal host for the choice builders. Owns the waitForClose promise and the
 * Svelte mount registry; subclasses implement display() to mount their root form
 * component (CaptureChoiceForm / TemplateChoiceForm) into contentEl. The former
 * imperative Setting helpers + reload() are gone — conditional settings now live
 * in the components' reactive {#if} blocks, which is the fix for issue #1130
 * (the modal no longer tears down/rebuilds on every toggle, preserving scroll
 * position and input focus/caret).
 */
export abstract class ChoiceBuilder extends Modal {
	private resolvePromise: (input: IChoice) => void;
	public waitForClose: Promise<IChoice>;
	abstract choice: IChoice;
	protected svelteElements: MountHandle[] = [];

	protected constructor(app: App) {
		super(app);

		this.waitForClose = new Promise<IChoice>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.containerEl.addClass("quickAddModal");
		this.open();
	}

	/**
	 * Mount the builder's Svelte form into contentEl. Called from the subclass
	 * constructor (NOT an onOpen() override): super() runs open() before the
	 * subclass has assigned this.choice, so mounting must happen afterwards.
	 */
	protected abstract display(): unknown;

	private destroySvelteElements() {
		this.svelteElements.forEach((handle) => handle.destroy());
		this.svelteElements = [];
	}

	/**
	 * The choice value to resolve at close. Converted (Svelte) builders override
	 * this to return the form's $state-backed proxy (`this.formProps.choice`) — a
	 * $state proxy does NOT write through to the original `this.choice`, so the
	 * original would be unedited (silent data loss, see persist.svelte.ts / #1130).
	 */
	protected getResultChoice(): IChoice {
		return this.choice;
	}

	onClose() {
		super.onClose();
		this.destroySvelteElements();
		// snapshot() deep-clones to a plain object, so callers that spread the
		// result never receive a live $state proxy.
		this.resolvePromise(snapshot(this.getResultChoice()));
	}
}
