<script lang="ts">
import type { App } from "obsidian";
import SettingItem from "../components/SettingItem.svelte";
import Toggle from "../components/Toggle.svelte";
import AppendLinkSetting from "../ChoiceBuilder/components/AppendLinkSetting.svelte";
import ValidatedInput from "../ChoiceBuilder/components/ValidatedInput.svelte";
import type { AppendLinkOptions } from "../../types/linkPlacement";
import { type LinkStep, RUN_NOTE } from "../../v3/model";
import type { NoteStep } from "./StepSettingsModal";

/** A Link it or Run Templater step's settings, as a modal's content. */
let {
	app,
	step,
	onSave,
	onCancel,
}: {
	app: App;
	step: NoteStep;
	onSave: (step: NoteStep) => void;
	onCancel: () => void;
} = $props();

// The modal edits a copy, which Save hands back.
// svelte-ignore state_referenced_locally
const initial = step;
let note = $state(initial.type === "link" ? initial.link : initial.note);
let inserting = $state(initial.type === "link" && initial.insert !== undefined);
let insert = $state<AppendLinkOptions>({
	enabled: true,
	...(initial.type === "link" && initial.insert ? initial.insert : { placement: "newLine", requireActiveFile: false }),
});
let copyToClipboard = $state(initial.type === "link" && initial.copyToClipboard === true);

const notes = $derived([RUN_NOTE, ...app.vault.getMarkdownFiles().map((file) => file.path)]);

function edited(): NoteStep {
	const target = note.trim() || RUN_NOTE;
	if (initial.type === "templater") return { ...initial, note: target };
	const { enabled: _enabled, ...options } = $state.snapshot(insert);
	const link: LinkStep = { ...initial, link: target };
	delete link.insert;
	delete link.copyToClipboard;
	if (inserting) link.insert = options;
	if (copyToClipboard) link.copyToClipboard = true;
	return link;
}
</script>

<h2 class="qa-modal-title">{initial.type === "link" ? "Link it" : "Run Templater"}</h2>

<SettingItem name="Note">
	{#snippet control()}
		<ValidatedInput
			bind:value={note}
			placeholder={RUN_NOTE}
			{app}
			suggestions={notes}
			maxSuggestions={50}
			ariaLabel="Note"
		/>
	{/snippet}
</SettingItem>

{#if initial.type === "link"}
	<SettingItem name="Insert">
		{#snippet control()}
			<Toggle bind:checked={inserting} ariaLabel="Insert" />
		{/snippet}
	</SettingItem>
	{#if inserting}
		<AppendLinkSetting bind:appendLink={insert} {app} />
	{/if}
	<SettingItem name="Copy to clipboard">
		{#snippet control()}
			<Toggle bind:checked={copyToClipboard} ariaLabel="Copy to clipboard" />
		{/snippet}
	</SettingItem>
{/if}

<div class="qa-command-button-row qa-command-button-row-compact">
	<button type="button" onclick={onCancel}>Cancel</button>
	<button type="button" class="mod-cta" onclick={() => onSave(edited())}>Save</button>
</div>
