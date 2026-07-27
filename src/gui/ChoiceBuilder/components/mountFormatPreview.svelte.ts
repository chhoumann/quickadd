import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import { mountComponent, type MountHandle } from "../../svelte/mountComponent";
import FormatPreviewField from "./FormatPreviewField.svelte";

/**
 * Hosts the Svelte `FormatPreviewField` in a modal that builds its DOM
 * imperatively.
 *
 * QuickAdd had one format-preview affordance and two implementations. The Svelte
 * one is the correct one: labelled, below the field it previews (#1543), a fresh
 * formatter per pass, a monotonic token so a slow pass cannot overwrite a newer
 * one's result, and the parse warnings collected inline instead of fired as an
 * Obsidian Notice per keystroke (#1558/#1560). The imperative copy had none of
 * that, and a second imperative fix would have left the same drift in place - so
 * the copy is deleted and the component is mounted instead (#1565).
 *
 * Lives in a `.svelte.ts` module so `$state` is available: mutating a
 * `$state`-backed props object is the documented way to feed reactive props to
 * an imperatively mounted Svelte 5 component (see `createCommandListProps`, the
 * same pattern for `CommandList`).
 */
export interface FormatPreviewHandle {
	/** Push the field's current value; call from the input's `onChange`. */
	setValue(value: string): void;
	/**
	 * Unmount the component and remove the host.
	 *
	 * The `destroyed` guard is not only about a double `destroy()` (mountComponent
	 * already guards that): it also makes `setValue` a no-op afterwards. A
	 * destroyed preview's textarea can still be alive and holding an `onChange`
	 * closure over this handle - `display()` tears the previews down and only then
	 * empties `contentEl` - and pushing into an unmounted component's `$state` is
	 * a write nothing will ever read.
	 */
	destroy(): void;
}

export function mountFormatPreview(
	container: HTMLElement,
	options: {
		app: App;
		plugin: QuickAdd;
		/** The field's value at mount time. */
		value: string;
	},
): FormatPreviewHandle {
	// The helper creates and owns its host rather than accepting an arbitrary
	// target: `mount()` writes anchor comment nodes into whatever it is given, and
	// these modals `createEl` straight onto `contentEl`, so mounting into a shared
	// container would interleave the anchors with later `new Setting(...)` rows.
	const host = container.ownerDocument.createElement("div");
	host.className = "qa-format-preview-host";
	container.appendChild(host);

	const props = $state({
		value: options.value,
		app: options.app,
		plugin: options.plugin,
		// Explicitly "no folder", not "folder unknown". The builders' "Folder/Name"
		// placeholder stands in for a choice's configured target folder; a modal
		// field that never creates a note has none, and inventing one would preview
		// `Folder/Name/2026-07-27` for a format the runtime resolves to
		// `/2026-07-27`.
		targetFolderPath: null,
	});

	const mounted: MountHandle = mountComponent(host, FormatPreviewField, props, {
		what: "the preview for this field",
	});
	let destroyed = false;

	return {
		setValue(value: string) {
			if (destroyed) return;
			props.value = value;
		},
		destroy() {
			if (destroyed) return;
			destroyed = true;
			mounted.destroy();
			host.remove();
		},
	};
}
