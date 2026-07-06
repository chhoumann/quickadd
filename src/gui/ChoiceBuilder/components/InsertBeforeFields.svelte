<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_TOP,
} from "../../../constants";
import {
	FormatSyntaxSuggester,
	FormatSyntaxToken,
} from "../../suggesters/formatSyntaxSuggester";
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

// Default the create-line fields synchronously at init (before bind:checked /
// the dropdown read them), matching the imperative addInsertBeforeFields. Without
// this, a legacy/imported insertBefore missing these keys would persist `undefined`
// and throw "Unknown createIfNotFoundLocation" in the capture formatter.
if (insertBefore.createIfNotFound === undefined)
	insertBefore.createIfNotFound = false;
if (!insertBefore.createIfNotFoundLocation)
	insertBefore.createIfNotFoundLocation = CREATE_IF_NOT_FOUND_TOP;

const suggesters = [
	// Line-target field: withhold {{foldercurrent}}, which formatLocationString
	// deliberately leaves literal in selectors (a legitimate "" resolution would
	// match the first line), so it is never suggested where it cannot resolve.
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, false, [
			FormatSyntaxToken.FolderCurrent,
		]),
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
<FormatPreviewField value={insertBefore.before} formatterKind="lineTarget" {app} {plugin} />
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
