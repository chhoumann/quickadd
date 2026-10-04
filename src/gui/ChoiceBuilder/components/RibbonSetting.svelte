<script lang="ts">
import SettingItem from "../../components/SettingItem.svelte";
import Toggle from "../../components/Toggle.svelte";
import { RIBBON_SETTING_NAME, actionInRibbon, setActionInRibbon } from "../actionRibbon";

/**
 * The action's ribbon icon. It is no setting of the choice, so it saves when
 * flipped, not with the rest of the builder.
 */
let { choiceId }: { choiceId: string } = $props();

const inRibbon = $derived(actionInRibbon(choiceId));
</script>

{#if inRibbon !== null}
	<SettingItem name={RIBBON_SETTING_NAME}>
		{#snippet control()}
			<Toggle
				checked={inRibbon}
				ariaLabel={RIBBON_SETTING_NAME}
				onchange={(value) => setActionInRibbon(choiceId, value)}
			/>
		{/snippet}
	</SettingItem>
{/if}
