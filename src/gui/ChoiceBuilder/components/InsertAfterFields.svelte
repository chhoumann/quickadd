<script lang="ts">
import type { App } from "obsidian";
import { Notice } from "obsidian";
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

/** Reactive port of captureChoiceBuilder.addInsertAfterFields. */
let {
	insertAfter = $bindable(),
	app,
	plugin,
}: {
	insertAfter: ICaptureChoice["insertAfter"];
	app: App;
	plugin: QuickAdd;
} = $props();

// Defaults the imperative builder set when this section rendered (insertAfter
// enabled). Applied synchronously at init — before the template's bind:checked
// reads them — and kept section-local, so the persisted shape only changes for
// choices whose write position actually reaches "After line…" (parity with the
// imperative addInsertAfterFields).
if (insertAfter.inline === undefined) insertAfter.inline = false;
if (insertAfter.replaceExisting === undefined)
	insertAfter.replaceExisting = false;
if (insertAfter.promptHeading === undefined) insertAfter.promptHeading = false;
if (!insertAfter.blankLineAfterMatchMode)
	insertAfter.blankLineAfterMatchMode = "auto";
if (!insertAfter.createIfNotFound) insertAfter.createIfNotFound = false;
if (!insertAfter.createIfNotFoundLocation)
	insertAfter.createIfNotFoundLocation = CREATE_IF_NOT_FOUND_TOP;

const suggesters = [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin),
];

const blankLineOptions = [
	{ value: "auto", label: "Auto (headings only)" },
	{ value: "skip", label: "Always skip" },
	{ value: "none", label: "Never skip" },
];

const createLocationOptions = [
	{ value: CREATE_IF_NOT_FOUND_TOP, label: "Top" },
	{ value: CREATE_IF_NOT_FOUND_BOTTOM, label: "Bottom" },
	{ value: CREATE_IF_NOT_FOUND_CURSOR, label: "Cursor" },
];

function onConsiderSubsectionsToggle(value: boolean) {
	// In heading mode the runtime target is always a heading, so the
	// "starts with #" guard would misfire against the empty/hidden `after` text.
	if (insertAfter.promptHeading) return;
	if (value && !insertAfter.after.startsWith("#")) {
		// Two-way bind syncs the toggle back to off when the target isn't a heading.
		insertAfter.considerSubsections = false;
		new Notice(
			"Consider subsections requires the target to be a heading (starts with #)",
		);
	}
}

function onPromptHeadingToggle(value: boolean) {
	// Heading mode always inserts on its own line under the picked heading (the block
	// path), so clear the inline same-line flags when it's switched on.
	if (value) {
		insertAfter.inline = false;
		insertAfter.replaceExisting = false;
	}
}
</script>

<SettingItem
	name="Choose heading when capturing"
	desc="Instead of typing a target line now, show a dropdown of the target note's headings when you run this capture and insert under the one you pick."
>
	{#snippet control()}
		<Toggle
			bind:checked={insertAfter.promptHeading}
			onchange={onPromptHeadingToggle}
		/>
	{/snippet}
</SettingItem>

{#if insertAfter.promptHeading}
	<div class="setting-item-description">
		You'll pick a heading from the target note when you run this capture, and the
		text is inserted under it. Use the toggles below to control placement within that
		section.
	</div>
{:else}
	<SettingItem
		name="Insert after"
		desc="Insert capture after specified text. Accepts format syntax. Tip: use a heading (starts with #) to target a section. Blank line handling is configurable below."
	/>
	<FormatPreviewField value={insertAfter.after} {app} {plugin} />
	<ValidatedInput
		bind:value={insertAfter.after}
		placeholder="Insert after"
		required
		requiredMessage="Insert after text is required"
		makeSuggesters={suggesters}
		ariaLabel="Insert after"
	/>

	<SettingItem
		name="Inline insertion"
		desc="Insert captured content on the same line, immediately after the matched text (no newline added)."
	>
		{#snippet control()}
			<Toggle bind:checked={insertAfter.inline} />
		{/snippet}
	</SettingItem>
{/if}

{#if insertAfter.inline}
	<SettingItem
		name="Replace existing value"
		desc="Replace everything after the matched text up to end-of-line."
	>
		{#snippet control()}
			<Toggle bind:checked={insertAfter.replaceExisting} />
		{/snippet}
	</SettingItem>
{:else}
	<SettingItem
		name="Insert at end of section"
		desc="Place the text at the end of the matched section instead of the top."
	>
		{#snippet control()}
			<Toggle bind:checked={insertAfter.insertAtEnd} />
		{/snippet}
	</SettingItem>

	<SettingItem
		name="Blank lines after match"
		desc={insertAfter.insertAtEnd
			? "Not used when inserting at end of section."
			: "Controls whether Insert After skips existing blank lines after the matched line."}
	>
		{#snippet control()}
			<Dropdown
				value={insertAfter.blankLineAfterMatchMode ?? "auto"}
				options={blankLineOptions}
				disabled={insertAfter.insertAtEnd}
				onchange={(value) =>
					(insertAfter.blankLineAfterMatchMode = value as
						| "auto"
						| "skip"
						| "none")}
			/>
		{/snippet}
	</SettingItem>

	<SettingItem
		name="Consider subsections"
		desc={insertAfter.promptHeading
			? "Also include the chosen heading’s subsections (nested headings inside its section)."
			: "Also include the section’s subsections (requires target to be a heading starting with #). Subsections are headings inside the section."}
	>
		{#snippet control()}
			<Toggle
				bind:checked={insertAfter.considerSubsections}
				onchange={onConsiderSubsectionsToggle}
			/>
		{/snippet}
	</SettingItem>
{/if}

<SettingItem
	name="Create line if not found"
	desc="Creates the 'insert after' line if it is not found."
>
	{#snippet control()}
		<Toggle bind:checked={insertAfter.createIfNotFound} />
		<Dropdown
			value={insertAfter.createIfNotFoundLocation || CREATE_IF_NOT_FOUND_TOP}
			options={createLocationOptions}
			onchange={(value) => (insertAfter.createIfNotFoundLocation = value)}
		/>
	{/snippet}
</SettingItem>
