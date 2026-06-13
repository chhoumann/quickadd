<script lang="ts">
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import Toggle from "../../components/Toggle.svelte";
import {
	normalizeFileOpening,
	type FileOpeningSettings,
} from "../../../utils/fileOpeningDefaults";
import type { FileViewMode2, OpenLocation } from "../../../types/fileOpening";

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

const locationOptions = [
	{ value: "reuse", label: "Reuse current tab" },
	{ value: "tab", label: "New tab" },
	{ value: "split", label: "Split pane" },
	{ value: "window", label: "New window" },
	{ value: "left-sidebar", label: "Left sidebar" },
	{ value: "right-sidebar", label: "Right sidebar" },
];

const directionOptions = [
	{ value: "vertical", label: "Split right" },
	{ value: "horizontal", label: "Split down" },
];

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
	name="File Opening Location"
	desc={`Where to open the ${contextLabel} file`}
>
	{#snippet control()}
		<Dropdown
			value={fileOpening.location}
			options={locationOptions}
			onchange={(value) => (fileOpening.location = value as OpenLocation)}
		/>
	{/snippet}
</SettingItem>

{#if fileOpening.location === "split"}
	<SettingItem
		name="Split Direction"
		desc="How to arrange the new pane relative to the current one"
	>
		{#snippet control()}
			<Dropdown
				value={fileOpening.direction}
				options={directionOptions}
				onchange={(value) =>
					(fileOpening.direction = value as FileOpeningSettings["direction"])}
			/>
		{/snippet}
	</SettingItem>
{/if}

<SettingItem name="View Mode" desc="How to display the opened file">
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
