import { type Component, type ComponentProps, mount, unmount } from "svelte";

/**
 * A handle to a Svelte 5 component mounted imperatively into an Obsidian host
 * (Modal contentEl, settings tab element, ...). Replaces the Svelte 4 class
 * instance that hosts used to keep around (and call `.$destroy()` on).
 */
export interface MountHandle {
	/** Unmount the component. Idempotent — safe to call from both onClose() and reload(). */
	destroy(): void;
}

/**
 * Mount a Svelte 5 component into `target` and return an idempotent handle.
 *
 * Single seam replacing `new Component({ target, props })` + `.$destroy()` across
 * ChoiceBuilder, CommandSequenceEditor, the PackageManager modals and the settings
 * tab. The idempotent `destroy()` guards the double-teardown that arises when a
 * Modal's `onClose()` runs after a `reload()` already tore the component down.
 *
 * To feed reactive updates after mount, pass a `$state`-backed props object and
 * mutate its properties (see createCommandListProps) — the documented Svelte 5
 * way to update an imperatively-mounted component.
 */
// Svelte's `Component` is contravariant in its props, so a generic upper bound
// that accepts ANY component cannot avoid `any` here: an `unknown`-based bound
// makes svelte-check reject components with concrete props (CommandList,
// FolderList, ...). This mirrors how Svelte's own `mount`/`ComponentProps` are
// typed, and `ComponentProps<C>` still gives each call site full prop checking.
export function mountComponent<C extends Component<any, any>>(
	target: HTMLElement,
	component: C,
	props: ComponentProps<C>,
): MountHandle {
	const instance = mount(component, { target, props });
	let destroyed = false;

	return {
		destroy() {
			if (destroyed) return;
			destroyed = true;
			void unmount(instance);
		},
	};
}
