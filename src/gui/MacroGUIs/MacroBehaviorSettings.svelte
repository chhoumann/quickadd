<script lang="ts">
import type { App } from "obsidian";
import type { MacroBehavior } from "./macroBehavior";
import SettingItem from "../components/SettingItem.svelte";
import Toggle from "../components/Toggle.svelte";
import OnePageOverrideSetting from "../ChoiceBuilder/components/OnePageOverrideSetting.svelte";
import DateOriginSetting from "../ChoiceBuilder/components/DateOriginSetting.svelte";
import CommandPaletteSetting from "../ChoiceBuilder/components/CommandPaletteSetting.svelte";
import ChoiceIconSetting from "../ChoiceBuilder/components/ChoiceIconSetting.svelte";

/** A macro's Behavior group, built from the settings the Template and Capture forms use. */
let {
	behavior = $bindable(),
	name,
	app,
}: {
	behavior: MacroBehavior;
	/** The macro's name, which labels its pick-a-day command. */
	name: string;
	app: App;
} = $props();
</script>

<OnePageOverrideSetting bind:onePageInput={behavior.onePageInput} />

<DateOriginSetting bind:dateOrigin={behavior.dateOrigin} />

<SettingItem name="Run on startup" desc="Execute this macro when Obsidian starts">
	{#snippet control()}
		<Toggle bind:checked={behavior.runOnStartup} ariaLabel="Run on startup" />
	{/snippet}
</SettingItem>

<CommandPaletteSetting
	bind:command={behavior.command}
	bind:pickDayCommand={behavior.pickDayCommand}
	{name}
	dateOrigin={behavior.dateOrigin}
/>

<ChoiceIconSetting bind:icon={behavior.icon} type="Macro" {app} />
