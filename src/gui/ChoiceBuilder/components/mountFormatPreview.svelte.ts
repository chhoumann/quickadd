import type { App } from "obsidian";
import type { FormatterPluginContext } from "../../../types/pluginContext";
import { mountComponent, type MountHandle } from "../../svelte/mountComponent";
import FormatPreviewField from "./FormatPreviewField.svelte";

/**
 * Hosts the Svelte FormatPreviewField in a modal that builds its DOM
 * imperatively. A `.svelte.ts` module so `$state` can feed reactive props to the
 * imperatively mounted component.
 */
export interface FormatPreviewHandle {
	/** Push the field's current value; call from the input's `onChange`. */
	setValue(value: string): void;
	/**
	 * Unmounts and removes the host. Also makes `setValue` a no-op, since a
	 * torn-down preview's textarea can still fire `onChange`.
	 */
	destroy(): void;
}

export function mountFormatPreview(
	container: HTMLElement,
	options: {
		app: App;
		plugin: FormatterPluginContext;
		/** The field's value at mount time. */
		value: string;
	},
): FormatPreviewHandle {
	// The helper creates and owns its host rather than accepting an arbitrary
	// target: `mount()` writes anchor comment nodes into whatever it is given, and
	// these modals `createEl` straight onto `contentEl`, so mounting into a shared
	// container would interleave the anchors with later `new Setting(...)` rows.
	const host = container.createDiv({ cls: "qa-format-preview-host" });

	const props = $state({
		value: options.value,
		app: options.app,
		plugin: options.plugin,
		// Explicitly no folder: a modal field never creates a note, and the
		// "Folder/Name" placeholder would invent one.
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
