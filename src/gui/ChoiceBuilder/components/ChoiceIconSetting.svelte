<script lang="ts">
import type { App } from "obsidian";
import { ICON_LIST } from "../../../types/IconType";
import type { ChoiceType } from "../../../types/choices/choiceType";
import { defaultIconForChoiceType } from "../../../utils/choiceUtils";
import ObsidianIcon from "../../components/ObsidianIcon.svelte";
import SettingItem from "../../components/SettingItem.svelte";
import { GenericTextSuggester } from "../../suggesters/genericTextSuggester";
import { suggester } from "./suggesterAction";

let {
	icon = $bindable(),
	type,
	app,
}: {
	icon?: string | undefined;
	type: ChoiceType;
	app: App;
} = $props();

const defaultIcon = $derived(defaultIconForChoiceType(type));
const inputValue = $derived(typeof icon === "string" ? icon : "");
const resolvedIcon = $derived(inputValue.trim() || defaultIcon);

function attachIconSuggester(
	el: HTMLInputElement | HTMLTextAreaElement,
): GenericTextSuggester {
	return new GenericTextSuggester(app, el, ICON_LIST, 50);
}

function onInput(event: Event) {
	const value = (event.currentTarget as HTMLInputElement).value.trim();
	icon = value || undefined;
}
</script>

<SettingItem
	name="Icon"
	desc={`Lucide/Obsidian icon id. Leave empty to use ${defaultIcon}.`}
>
	{#snippet control()}
		<div class="qa-choice-icon-setting-control">
			<span class="qa-choice-icon-setting-preview" aria-hidden="true">
				<ObsidianIcon iconId={resolvedIcon} size={18} />
			</span>
			<input
				type="text"
				class="qa-choice-icon-input"
				value={inputValue}
				placeholder={defaultIcon}
				aria-label="Choice icon"
				oninput={onInput}
				use:suggester={attachIconSuggester}
			/>
		</div>
	{/snippet}
</SettingItem>

<style>
	.qa-choice-icon-setting-control {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: min(18rem, 100%);
	}

	.qa-choice-icon-setting-preview {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		color: var(--text-muted);
	}

	.qa-choice-icon-input {
		width: 100%;
		min-width: 0;
	}
</style>
