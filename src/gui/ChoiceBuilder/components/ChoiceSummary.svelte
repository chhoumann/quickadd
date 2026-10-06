<script lang="ts">
import { settingsStore } from "../../../settingsStore";
import type IChoice from "../../../types/choices/IChoice";
import { resolveChoiceIcon } from "../../../utils/choiceUtils";
import { summarizeChoice } from "../../../v3/choiceSummary";
import Lede from "./Lede.svelte";

/**
 * What the choice does, in one line at the top of its builder. Reads the
 * whole form's choice, so every edit below rewrites it.
 */
let { choice, runsTemplater = false }: { choice: IChoice; runsTemplater?: boolean } = $props();

// What the builder knows from the template file, which the summary cannot read.
const summary = $derived(
	summarizeChoice($state.snapshot(choice) as IChoice, settingsStore.getState().choices) +
		(runsTemplater ? ", runs Templater" : ""),
);
</script>

<Lede iconId={resolveChoiceIcon(choice)} text={summary} />
