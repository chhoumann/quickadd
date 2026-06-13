<script lang="ts">
import type { App } from "obsidian";
import ObsidianIcon from "../../components/ObsidianIcon.svelte";
import { promptRenameChoice } from "../../choiceRename";

/**
 * Centered, clickable choice-name heading with a rename affordance. The rename
 * control is a real <button> inside the <h2> so the heading keeps its heading
 * role for screen readers (#1250). Replaces ChoiceBuilder.addCenteredChoiceNameHeader.
 */
let {
	name = $bindable(),
	app,
}: {
	name: string;
	app: App;
} = $props();

async function rename() {
	const newName = await promptRenameChoice(app, name);
	if (!newName) return;
	name = newName;
}
</script>

<h2 class="choiceNameHeader">
	<button
		type="button"
		class="choiceNameHeaderButton qa-rename-title-button"
		aria-label={`Rename ${name}`}
		onclick={rename}
	>
		<span class="choiceNameHeaderText">{name}</span>
		<span class="choiceNameHeaderIcon" aria-hidden="true">
			<ObsidianIcon iconId="pencil" size={16} />
		</span>
	</button>
</h2>
