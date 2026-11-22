import type { App } from "obsidian";
import { Modal } from "obsidian";
import type { Component } from "svelte";
import { mountComponent, type MountHandle } from "./mountComponent";

interface SvelteModalSpec<Props extends object> {
	title: string;
	cls: string[];
	component: Component<Props>;
	/** The component's props, given the modal's close function. */
	props: (close: () => void) => Props;
	/** Names the surface in the notice a failed mount reports. */
	what: string;
}

/** A modal whose whole body is one Svelte component, mounted on open and destroyed on close. */
export class SvelteModal<Props extends object> extends Modal {
	private handle: MountHandle | null = null;

	constructor(
		app: App,
		private readonly spec: SvelteModalSpec<Props>,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass(...this.spec.cls);
		this.setTitle(this.spec.title);
		this.handle = mountComponent(
			this.contentEl,
			this.spec.component,
			this.spec.props(() => this.close()),
			{ what: this.spec.what },
		);
	}

	onClose(): void {
		this.handle?.destroy();
		this.handle = null;
	}
}
