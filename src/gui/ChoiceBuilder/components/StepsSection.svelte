<script lang="ts">
import { Menu } from "obsidian";
import type IChoice from "../../../types/choices/IChoice";
import { newStep, type NewStepKind } from "../../../v3/addStep";
import { migrateChoice } from "../../../v3/migrate";
import type { Step } from "../../../v3/model";
import { describeStepLine } from "../../../v3/summary";
import SettingGroup from "../../components/SettingGroup.svelte";

/**
 * What the choice does, as the steps of its action, and a way to add one
 * after them, which makes the choice a sequence of steps.
 */
let {
	choice,
	onAddStep = undefined,
}: {
	choice: IChoice;
	onAddStep?: (step: Step) => void;
} = $props();

// Reads the whole form's choice, so it follows every edit.
const lines = $derived.by(() => {
	try {
		const { node } = migrateChoice($state.snapshot(choice) as IChoice);
		return node.kind === "action" ? node.steps.map((step) => describeStepLine(step)) : null;
	} catch {
		return null;
	}
});

const KINDS: { kind: NewStepKind; title: string; icon: string }[] = [
	{ kind: "runScript", title: "Run a script", icon: "code" },
	{ kind: "open", title: "Open a note", icon: "file" },
	{ kind: "wait", title: "Wait", icon: "clock" },
];

let menuOpen = $state(false);

function openMenu(evt: MouseEvent) {
	const add = onAddStep;
	if (!add) return;
	const menu = new Menu();
	for (const { kind, title, icon } of KINDS) {
		menu.addItem((item) => item.setTitle(title).setIcon(icon).onClick(() => add(newStep(kind))));
	}
	menuOpen = true;
	menu.onHide(() => (menuOpen = false));
	// Under the button, found from the target: the event's currentTarget is
	// Svelte's delegation root, and a key press has no position of its own.
	const target = evt.target as HTMLElement;
	const rect = (target.closest("button") ?? target).getBoundingClientRect();
	menu.showAtPosition({ x: rect.left, y: rect.bottom + 4, width: rect.width, overlap: true, left: true });
}
</script>

{#if lines}
	<SettingGroup heading="Steps">
		<div class="setting-item qaStepsSetting">
			<div class="setting-item-info">
				<ol class="qaStepsList">
					{#each lines as line, index (index)}
						<li>{line}</li>
					{/each}
				</ol>
			</div>
			{#if onAddStep}
				<div class="setting-item-control">
					<button
						type="button"
						aria-label="Add a step"
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						onclick={openMenu}
					>Add a step</button>
				</div>
			{/if}
		</div>
	</SettingGroup>
{/if}

<style>
	.qaStepsList {
		margin: 0;
		padding-inline-start: 1.5em;
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
		line-height: var(--line-height-tight);
	}

	.qaStepsList li + li {
		margin-top: var(--size-2-1);
	}
</style>
