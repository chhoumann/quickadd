<script lang="ts">
import type { DateOrigin } from "../../../types/dateOrigin";
import {
	COMMAND_SETTING_DESC,
	COMMAND_SETTING_NAME,
	PICK_DAY_SETTING_DESC,
	canOfferPickDayCommand,
	pickDaySettingName,
} from "../../../types/choiceCommands";
import SettingItem from "../../components/SettingItem.svelte";
import Toggle from "../../components/Toggle.svelte";

/**
 * The choice's command palette entries. The same `command` flag is toggled
 * from the choice list; this is its home in the settings modal, so the
 * pick-a-day sub-option can sit under the parent it depends on.
 */
let {
	command = $bindable(),
	pickDayCommand = $bindable(),
	name,
	dateOrigin,
}: {
	command: boolean;
	pickDayCommand?: boolean;
	name: string;
	dateOrigin: DateOrigin | undefined;
} = $props();

const showPickDay = $derived(command && canOfferPickDayCommand(dateOrigin));
</script>

<SettingItem name={COMMAND_SETTING_NAME} desc={COMMAND_SETTING_DESC}>
	{#snippet control()}
		<Toggle bind:checked={command} ariaLabel={COMMAND_SETTING_NAME} />
	{/snippet}
</SettingItem>

{#if showPickDay}
	<SettingItem name={pickDaySettingName(name)} desc={PICK_DAY_SETTING_DESC}>
		{#snippet control()}
			<Toggle
				bind:checked={pickDayCommand}
				ariaLabel={pickDaySettingName(name)}
			/>
		{/snippet}
	</SettingItem>
{/if}
