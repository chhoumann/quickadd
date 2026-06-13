<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_TOP,
} from "../../../constants";
import { FormatSyntaxSuggester } from "../../suggesters/formatSyntaxSuggester";
import SettingItem from "../../components/SettingItem.svelte";
import Toggle from "../../components/Toggle.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import FormatPreviewField from "./FormatPreviewField.svelte";

/** Reactive port of captureChoiceBuilder.addInsertBeforeFields. */
let {
	insertBefore = $bindable(),
	app,
	plugin,
}: {
	insertBefore: NonNullable<ICaptureChoice["insertBefore"]>;
	app: App;
	plugin: QuickAdd;
} = $props();

const suggesters = [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin),
];

const createLocationOptions = [
	{ value: CREATE_IF_NOT_FOUND_TOP, label: "Top" },
	{ value: CREATE_IF_NOT_FOUND_BOTTOM, label: "Bottom" },
	{ value: CREATE_IF_NOT_FOUND_CURSOR, label: "Cursor" },
];
</script>

<SettingItem
	name="Insert before"
	desc="Insert capture before specified text. Accepts format syntax."
/>
<FormatPreviewField value={insertBefore.before} {app} {plugin} />
<ValidatedInput
	bind:value={insertBefore.before}
	placeholder="Insert before"
	required
	requiredMessage="Insert before text is required"
	makeSuggesters={suggesters}
	ariaLabel="Insert before"
/>

<SettingItem
	name="Create line if not found"
	desc="Creates the 'insert before' line if it is not found."
>
	{#snippet control()}
		<Toggle bind:checked={insertBefore.createIfNotFound} />
		<Dropdown
			value={insertBefore.createIfNotFoundLocation || CREATE_IF_NOT_FOUND_TOP}
			options={createLocationOptions}
			onchange={(value) => (insertBefore.createIfNotFoundLocation = value)}
		/>
	{/snippet}
</SettingItem>
