<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import { FILE_NAME_FORMAT_SYNTAX } from "../../../constants";
import { getAllFolderPathsInVault } from "../../../utilityObsidian";
import { sortFolderPathsByTree } from "../../../utils/folder-sorting";
import { FormatSyntaxSuggester } from "../../suggesters/formatSyntaxSuggester";
import { isCanvasTargetPath, normalizeVaultPath } from "../canvasNodes";
import { isPropertyTarget, parsePropertyTarget } from "../../../utils/propertyTarget";
import SettingItem from "../../components/SettingItem.svelte";
import Toggle from "../../components/Toggle.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import FormatPreviewField from "./FormatPreviewField.svelte";
import CanvasNodePicker from "./CanvasNodePicker.svelte";

/** Reactive port of captureChoiceBuilder.addCapturedToSetting. */
let {
	choice = $bindable(),
	app,
	plugin,
}: {
	choice: ICaptureChoice;
	app: App;
	plugin: QuickAdd;
} = $props();

const captureTargetSuggestions = $derived.by(() => {
	const folderPaths = sortFolderPathsByTree(getAllFolderPathsInVault(app))
		.filter((folderPath) => folderPath.length > 0)
		.map((folderPath) =>
			folderPath.endsWith("/") ? folderPath : folderPath + "/",
		);
	const markdownPaths = app.vault.getMarkdownFiles().map((file) => file.path);
	const canvasPaths = app.vault
		.getFiles()
		.filter((file) => file.extension === "canvas")
		.map((file) => file.path);
	return Array.from(
		new Set([
			...folderPaths,
			...markdownPaths,
			...canvasPaths,
			...FILE_NAME_FORMAT_SYNTAX,
		]),
	);
});

const suggesters = [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin),
];

const isCanvasTarget = $derived(isCanvasTargetPath(choice.captureTo));

// A `property:` target filters notes by a frontmatter field — it is NOT a path,
// so showing the file-name format preview would render a misleading fake path.
const isProperty = $derived(isPropertyTarget(choice.captureTo ?? ""));
const propertyHint = $derived.by(() => {
	const parsed = parsePropertyTarget(choice.captureTo ?? "");
	if (!parsed || !parsed.field) {
		return "Add a field name, e.g. property:type=draft";
	}
	return parsed.value !== undefined
		? `Filters notes whose frontmatter ${parsed.field} = ${parsed.value}`
		: `Filters notes that have the frontmatter field ${parsed.field}`;
});

function onCaptureToActiveFileChange(value: boolean) {
	// Read the prior state BEFORE mutating (one-way toggle, not bind).
	const wasActiveBottomMode =
		!!choice.captureToActiveFile &&
		choice.activeFileWritePosition === "bottom";

	choice.captureToActiveFile = value;

	if (!value && wasActiveBottomMode) {
		choice.prepend = true;
	}
	// New-line capture is only valid for active-file capture.
	if (!value && choice.newLineCapture?.enabled) {
		choice.newLineCapture.enabled = false;
	}
}

function onCaptureToChange(value: string) {
	const previousCanvasPath = normalizeVaultPath(choice.captureTo);
	const wasCanvasTarget = isCanvasTargetPath(choice.captureTo);
	choice.captureTo = value;
	const nextCanvasPath = normalizeVaultPath(value);
	const nextIsCanvasTarget = isCanvasTargetPath(value);
	const canvasPathChanged =
		wasCanvasTarget &&
		nextIsCanvasTarget &&
		previousCanvasPath !== nextCanvasPath;

	if (!nextIsCanvasTarget || canvasPathChanged) {
		choice.captureToCanvasNodeId = "";
	}
}
</script>

<SettingItem
	name="Capture to"
	desc="Vault-relative path, #tag, or property:field=value. Supports format syntax (use trailing '/' for folders)."
/>

<SettingItem name="Capture to active file">
	{#snippet control()}
		<Toggle
			checked={choice.captureToActiveFile}
			onchange={onCaptureToActiveFileChange}
		/>
	{/snippet}
</SettingItem>

{#if !choice.captureToActiveFile}
	<SettingItem
		name="File path / format"
		desc={"Choose a file, folder, #tag, property:field=value, or format syntax (e.g., {{DATE}})"}
	/>
	{#if isProperty}
		<div class="qa-field-hint qa-field-hint--neutral">{propertyHint}</div>
	{:else}
		<FormatPreviewField value={choice.captureTo} formatterKind="fileName" {app} {plugin} />
	{/if}
	<ValidatedInput
		value={choice.captureTo}
		placeholder="File name format"
		{app}
		suggestions={captureTargetSuggestions}
		maxSuggestions={50}
		makeSuggesters={suggesters}
		ariaLabel="File path / format"
		onChange={onCaptureToChange}
	/>

	{#if isCanvasTarget}
		<SettingItem
			name="Target canvas node"
			desc="Choose a card from the canvas below, or paste an exact node id."
		>
			{#snippet control()}
				<ValidatedInput
					value={choice.captureToCanvasNodeId ?? ""}
					placeholder="Canvas node id"
					ariaLabel="Canvas node id"
					onChange={(value) => (choice.captureToCanvasNodeId = value.trim())}
				/>
			{/snippet}
		</SettingItem>

		<div class="qa-canvas-node-helper">
			Tip: open this canvas and select one card to grab its id instantly.
		</div>

		{#key choice.captureTo}
			<CanvasNodePicker
				bind:nodeId={choice.captureToCanvasNodeId}
				canvasTargetPath={choice.captureTo}
				{app}
			/>
		{/key}
	{/if}
{/if}
