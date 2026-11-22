<script lang="ts">
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import Toggle from "../../components/Toggle.svelte";
import { normalizeFileOpening } from "../../../utils/fileOpeningDefaults";
import { openLocationOptions, splitDirectionOptions } from "../fileOpeningOptions";
import type { FileOpeningSettings, FileViewMode2, OpenLocation } from "../../../types/fileOpening";

/**
 * Replaces ChoiceBuilder.addFileOpeningSetting. Conditional rows (split
 * direction, focus toggle) are reactive `{#if}` blocks instead of `reload()`.
 */
let {
	fileOpening = $bindable(),
	contextLabel,
}: {
	fileOpening: FileOpeningSettings;
	contextLabel: string;
} = $props();

// This section only mounts when Open is enabled. An imported/legacy choice can
// reach here with a missing/partial fileOpening (toggling Open true after mount),
// so normalize at init — before the template dereferences .location/.mode — the
// same point the imperative addFileOpeningSetting normalized. (#1130 review)
fileOpening = normalizeFileOpening(fileOpening);

const modeOptions = [
	{ value: "source", label: "Source" },
	{ value: "preview", label: "Preview" },
	{ value: "live", label: "Live Preview" },
	{ value: "default", label: "Default" },
];

const modeValue = $derived(
	typeof fileOpening.mode === "string" ? (fileOpening.mode as string) : "default",
);
</script>

<SettingItem
	name="File opening location"
	desc={`Where to open the ${contextLabel} file`}
>
	{#snippet control()}
		<Dropdown
			value={fileOpening.location}
			options={openLocationOptions}
			onchange={(value) => (fileOpening.location = value as OpenLocation)}
		/>
	{/snippet}
</SettingItem>

{#if fileOpening.location === "split"}
	<SettingItem
		name="Split direction"
		desc="How to arrange the new pane relative to the current one"
	>
		{#snippet control()}
			<Dropdown
				value={fileOpening.direction}
				options={splitDirectionOptions}
				onchange={(value) =>
					(fileOpening.direction = value as FileOpeningSettings["direction"])}
			/>
		{/snippet}
	</SettingItem>
{/if}

<SettingItem name="View mode" desc="How to display the opened file">
	{#snippet control()}
		<Dropdown
			value={modeValue}
			options={modeOptions}
			onchange={(value) => (fileOpening.mode = value as FileViewMode2)}
		/>
	{/snippet}
</SettingItem>

{#if fileOpening.location !== "reuse"}
	<SettingItem
		name="Focus new pane"
		desc="Focus the opened tab immediately after opening"
	>
		{#snippet control()}
			<Toggle bind:checked={fileOpening.focus} />
		{/snippet}
	</SettingItem>
{/if}
