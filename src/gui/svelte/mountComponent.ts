import { type Component, mount, unmount } from "svelte";

/**
 * A handle to a Svelte 5 component mounted imperatively into an Obsidian host
 * (Modal contentEl, settings tab element, ...). Replaces the Svelte 4 class
 * instance that hosts used to keep around (and call `.$destroy()` on).
 */
export interface MountHandle<Exports extends Record<string, unknown> = Record<string, unknown>> {
	/** The component's exported members (Svelte 5 `mount` returns the exports, not a class instance). */
	readonly instance: Exports;
	/** Unmount the component. Idempotent — safe to call from both onClose() and reload(). */
	destroy(): void;
}

/**
 * Mount a Svelte 5 component into `target` and return an idempotent handle.
 *
 * This is the single seam replacing `new Component({ target, props })` +
 * `.$destroy()` across ChoiceBuilder, CommandSequenceEditor, the PackageManager
 * modals and the settings tab. The idempotent `destroy()` guards against the
 * double-teardown that arises when a Modal's `onClose()` runs after a `reload()`
 * has already torn the component down.
 */
export function mountComponent<
	Props extends Record<string, unknown>,
	Exports extends Record<string, unknown>,
>(
	target: HTMLElement,
	component: Component<Props, Exports>,
	props: Props,
): MountHandle<Exports> {
	const instance = mount(component, { target, props });
	let destroyed = false;

	return {
		get instance() {
			return instance;
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			void unmount(instance);
		},
	};
}
