<script lang="ts">
import type { App } from "obsidian";
import { FIELD_VARIABLE_PREFIX } from "../../../constants";
import type IChoice from "../../../types/choices/IChoice";
import { getTemplateFile } from "../../../utils/templateFolderUtils";
import { isFolder } from "../../../utils/vaultQueries";
import { type ActionInput, listInputs } from "../../../v3/inputs";
import { migrateChoice } from "../../../v3/migrate";
import { settingsStore } from "../../../settingsStore";
import type { InputOverride } from "../../../v3/model";
import SettingGroup from "../../components/SettingGroup.svelte";
import Toggle from "../../components/Toggle.svelte";
import { actionInputOverrides, setActionInputOverride } from "../actionInputs";

/**
 * What a run of the choice asks for, read from its placeholders, with a
 * label and optional of its own for each. Those are the action's, so they
 * save as they change, not with the rest of the builder.
 */
let { choice, app }: { choice: IChoice; app: App } = $props();

let inputs = $state<ActionInput[] | null>(null);
// Null when the choice is not an action of its own: then nothing is editable.
// Set again after each change, as the store is no Svelte state.
let overrides = $derived(actionInputOverrides(choice.id));

// Reads the whole form's choice, so it follows every edit.
$effect(() => {
	let node;
	try {
		node = migrateChoice($state.snapshot(choice) as IChoice).node;
	} catch {
		inputs = null;
		return;
	}
	if (node.kind !== "action") return;
	let current = true;
	void listInputs(node, readTemplate, (path) => isFolder(app, path), settingsStore.getState()).then(
		(list) => {
			if (current) inputs = list;
		},
		() => {
			if (current) inputs = null;
		},
	);
	return () => {
		current = false;
	};
});

async function readTemplate(path: string): Promise<string | null> {
	const file = getTemplateFile(app, path);
	return file ? await app.vault.cachedRead(file) : null;
}

const EDITABLE: ReadonlySet<ActionInput["kind"]> = new Set(["value", "date", "file"]);

function nameOf(input: ActionInput): string {
	if (input.kind === "pick") return "Target note";
	if (input.kind === "file") return input.label ?? input.name;
	if (input.kind === "field") return input.name.slice(FIELD_VARIABLE_PREFIX.length);
	// The one {{VALUE}} has no name of its own; its prompt's title stands in.
	if (input.name === "value") return input.label ?? "Value";
	return input.name;
}

/** The kind, unless the name already says it. Templater's own prompts are its to type. */
function kindOf(input: ActionInput): string | null {
	if (input.askedBy) return null;
	return nameOf(input).toLowerCase() === input.kind ? null : input.kind;
}

const WHERE: Record<Exclude<ActionInput["definedIn"]["where"], "template file">, string> = {
	templatePath: "Defined in the template path",
	folder: "Defined in the folder",
	fileName: "Defined in the note name",
	target: "Defined in the target",
	format: "Defined in the format",
};

function fileName(path: string): string {
	return path.split("/").pop() ?? path;
}

function openTemplate(event: MouseEvent, path: string) {
	event.preventDefault();
	const file = getTemplateFile(app, path);
	if (file) void app.workspace.getLeaf(true).openFile(file);
}

function change(name: string, value: Partial<InputOverride>) {
	setActionInputOverride(choice.id, name, value);
	overrides = actionInputOverrides(choice.id);
}
</script>

{#if inputs}
	<SettingGroup heading="Inputs">
		{#if inputs.length === 0}
			<!-- tabindex -1, as Obsidian's own rows: its settings keys move focus between rows. -->
			<div class="setting-item qaInputsEmpty" tabindex="-1">
				<div class="setting-item-info">
					<div class="setting-item-description">No inputs</div>
				</div>
			</div>
		{/if}
		{#each inputs as input (`${input.askedBy ?? "quickadd"}:${input.name}`)}
			{@const provided = input.providedBy !== undefined || input.askedBy !== undefined}
			{@const override = overrides?.[input.name]}
			<div class="setting-item qaInputRow" class:qaInputProvided={provided} data-input={input.name} tabindex="-1">
				<div class="setting-item-info">
					<div class="setting-item-name">
						{nameOf(input)}
						{#if kindOf(input)}<span class="qaInputKind">{kindOf(input)}</span>{/if}
					</div>
					<div class="setting-item-description">
						{#if input.askedBy && input.definedIn.path}
							{@const path = input.definedIn.path}
							Asked by Templater, in <a href={path} onclick={(event) => openTemplate(event, path)}>{fileName(path)}</a>
						{:else if provided}
							Provided by step {(input.providedBy ?? 0) + 1}
						{:else if input.definedIn.where === "template file" && input.definedIn.path}
							{@const path = input.definedIn.path}
							Defined in <a href={path} onclick={(event) => openTemplate(event, path)}>{fileName(path)}</a>
						{:else if input.definedIn.where !== "template file"}
							{WHERE[input.definedIn.where]}
						{/if}
					</div>
				</div>
				{#if overrides && !provided && EDITABLE.has(input.kind)}
					<div class="setting-item-control">
						<input
							type="text"
							aria-label="Label"
							placeholder={input.label ?? input.name}
							value={override?.label ?? ""}
							oninput={(event) => {
								const value = event.currentTarget.value;
								change(input.name, { label: value.trim() === "" ? undefined : value });
							}}
						/>
						<span class="qaInputOptional">Optional</span>
						<Toggle
							checked={override?.optional ?? input.optional}
							ariaLabel="Optional"
							onchange={(value) => change(input.name, { optional: value === input.optional ? undefined : value })}
						/>
					</div>
				{/if}
			</div>
		{/each}
	</SettingGroup>
{/if}

<style>
	.qaInputKind {
		margin-inline-start: var(--size-4-1);
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-normal);
	}

	.qaInputProvided .setting-item-name {
		color: var(--text-muted);
	}

	.qaInputOptional {
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}
</style>
