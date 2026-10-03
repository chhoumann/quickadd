import type { App } from "obsidian";
import type { Component } from "svelte";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import { mountComponent, type MountHandle } from "../svelte/mountComponent";
import { snapshot } from "../svelte/persist.svelte";
import { BuilderPage, nameOrFallback } from "./builderPage";
import { createChoiceFormProps, type ChoiceFormProps } from "./choiceFormProps.svelte";

/**
 * Settings page for the Template and Capture builders: a Name field over the
 * builder's Svelte form (TemplateChoiceForm / CaptureChoiceForm), whose
 * conditional settings live in reactive {#if} blocks, so a toggle never
 * rebuilds the page (#1130). Hands the edited choice to `onSave` when the
 * page is left.
 */
export abstract class ChoiceBuilder<C extends IChoice> extends BuilderPage<IChoice> {
	private formProps?: ChoiceFormProps<C>;
	private handle: MountHandle | null = null;
	/** The Name field's value. Kept here so a rename saves even if the form fails to mount. */
	private name: string;

	/**
	 * Subclasses fill in missing fields on `choice` in their constructor, before
	 * the page renders, so the form reads a fully-shaped object.
	 */
	protected constructor(
		app: App,
		public readonly choice: C,
		private readonly plugin: QuickAdd,
		onSave: (choice: IChoice) => void,
		private readonly form: Component<ChoiceFormProps<C>>,
		/** What the form shows, for the card shown if it fails to mount. */
		private readonly what: string,
	) {
		super(app, choice.name, onSave);
		this.name = choice.name;
	}

	protected render(containerEl: HTMLElement): void {
		// The form edits a $state copy; edits never write through to `choice`.
		const props = createChoiceFormProps<C>({
			choice: this.choice,
			app: this.app,
			plugin: this.plugin,
		});
		this.addNameSetting(containerEl, this.name, this.choice.name, (name) => {
			this.name = name;
			props.choice.name = name;
		});
		this.handle = mountComponent(containerEl, this.form, props, { what: this.what });
		// An unseen form must not replace the source choice on close.
		if (this.handle.ok) this.formProps = props;
	}

	/**
	 * snapshot() deep-clones the form's $state copy to a plain object, so
	 * callers never receive a live $state proxy.
	 */
	protected result(): IChoice {
		// A save in place leaves the form mounted, so it commits what it holds.
		this.formProps?.commitPending?.();
		const edited = snapshot(this.formProps?.choice ?? this.choice);
		return { ...edited, name: nameOrFallback(this.name, this.choice.name) };
	}

	protected destroy(): void {
		this.handle?.destroy();
		this.handle = null;
	}
}
