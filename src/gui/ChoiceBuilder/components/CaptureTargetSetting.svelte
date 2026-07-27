<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import { getAllFolderPathsInVault } from "../../../utilityObsidian";
import { sortFolderPathsByTree } from "../../../utils/folder-sorting";
import { FormatSyntaxSuggester } from "../../suggesters/formatSyntaxSuggester";
import { isCanvasTargetPath, normalizeVaultPath } from "../canvasNodes";
import SettingItem from "../../components/SettingItem.svelte";
import Toggle from "../../components/Toggle.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import LabeledField from "./LabeledField.svelte";
import FormatPreviewField from "./FormatPreviewField.svelte";
import FormatTokenHint from "./FormatTokenHint.svelte";
import CanvasNodePicker from "./CanvasNodePicker.svelte";
import { getCaptureTargetFeedback } from "./captureTargetFeedback";

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
	// Paths only. Format tokens used to be mixed in here too, which put a second
	// suggester's undescribed, differently-cased copy of the token list on the
	// same input as FormatSyntaxSuggester: two stacked popups for one language,
	// and the generic one replaces the whole field on accept (#1542).
	return Array.from(new Set([...folderPaths, ...markdownPaths, ...canvasPaths]));
});

const suggesters = [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, "captureTarget"),
];

const captureTargetFeedback = $derived.by(() =>
	getCaptureTargetFeedback(choice.captureTo ?? ""),
);
// Filter/property targets are not paths, so showing the file-name format preview
// would render a misleading fake path.
const usesPickerTargetSyntax = $derived(captureTargetFeedback !== null);
// The same question, asked of the RESOLVED text. The gate above reads the raw
// field, but the run resolves the target's format tokens BEFORE parsing it
// (CaptureChoiceEngine formats captureTo, then resolveCaptureTarget), so a
// target written as `{{GLOBAL_VAR:inbox}}` that expands to `property:type=draft`
// passes the raw gate and then gets previewed as a path - complete with #1578's
// "cannot contain a colon" error for a capture that runs perfectly well.
const isPickerTargetSyntax = (resolved: string) =>
	getCaptureTargetFeedback(resolved) !== null;
// Exclude picker syntax from canvas detection so a contrived value like
// `property:type=foo.canvas` never offers the (meaningless) canvas-node picker.
const isCanvasTarget = $derived(
	!usesPickerTargetSyntax && isCanvasTargetPath(choice.captureTo),
);

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
	const nextUsesPickerTargetSyntax = getCaptureTargetFeedback(value) !== null;
	choice.captureTo = value;
	const nextCanvasPath = normalizeVaultPath(value);
	const nextIsCanvasTarget = isCanvasTargetPath(value);
	const canvasPathChanged =
		wasCanvasTarget &&
		nextIsCanvasTarget &&
		previousCanvasPath !== nextCanvasPath;

	if (nextUsesPickerTargetSyntax || !nextIsCanvasTarget || canvasPathChanged) {
		choice.captureToCanvasNodeId = "";
	}
}

function validateCaptureTo(value: string) {
	const feedback = getCaptureTargetFeedback(value);
	if (!feedback) {
		// An empty target is a supported mode, not an omission: it resolves to the
		// vault-wide note picker at run time (resolveCaptureTarget -> "vault"). Say
		// so, rather than leaving a blank field looking unfinished.
		if (!value.trim()) {
			return {
				valid: true,
				message: "Leave empty to pick the note each time this choice runs.",
			};
		}
		return true;
	}

	return {
		valid: feedback.valid,
		message: feedback.message,
		variant: feedback.valid ? ("success" as const) : undefined,
	};
}
</script>

<SettingItem
	name="Capture to active file"
	desc="Capture into whichever note is open when the choice runs, instead of a fixed target."
>
	{#snippet control()}
		<Toggle
			checked={choice.captureToActiveFile}
			onchange={onCaptureToActiveFileChange}
		/>
	{/snippet}
</SettingItem>

{#if !choice.captureToActiveFile}
	<LabeledField
		name="Capture to"
		desc={"Vault-relative path to a file or folder, a #tag, or property:field=value. Supports format syntax like {{DATE}}; end with '/' to capture into a folder."}
	>
		{#snippet children(id)}
			<ValidatedInput
				{id}
				value={choice.captureTo}
				placeholder={"Daily/{{DATE}}.md"}
				{app}
				suggestions={captureTargetSuggestions}
				maxSuggestions={50}
				makeSuggesters={suggesters}
				validator={validateCaptureTo}
				onChange={onCaptureToChange}
			/>
			<FormatTokenHint value={choice.captureTo} />
			{#if !usesPickerTargetSyntax}
				<FormatPreviewField
					value={choice.captureTo}
					formatterKind="fileName"
					{app}
					{plugin}
					hideWhen={isPickerTargetSyntax}
				/>
			{/if}
		{/snippet}
	</LabeledField>

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
					required
					requiredMessage="A canvas capture target requires a node id — pick a card below or paste an exact node id."
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
