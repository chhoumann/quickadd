<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import type {
	FileExistsBehaviorCategoryId,
	FileExistsModeId,
} from "../../template/fileExistsPolicy";
import {
	fileExistsBehaviorCategoryOptions,
	getBehaviorCategory,
	getDefaultBehaviorForCategory,
	getFileExistsMode,
	getModesForCategory,
} from "../../template/fileExistsPolicy";
import { log } from "../../logger/logManager";
import { getAllFolderPathsInVault, getTemplateFile } from "../../utilityObsidian";
import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";
import { sortFolderPathsByTree } from "../../utils/folder-sorting";
import { ExclusiveSuggester } from "../suggesters/exclusiveSuggester";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import FolderList from "./FolderList.svelte";
import {
	applyFolderMode,
	deriveFolderMode,
	folderModeDescriptions,
	folderModeOptions,
	type FolderMode,
} from "./folderMode";
import SettingItem from "../components/SettingItem.svelte";
import Toggle from "../components/Toggle.svelte";
import Dropdown from "../components/Dropdown.svelte";
import ChoiceNameHeader from "./components/ChoiceNameHeader.svelte";
import ValidatedInput from "./components/ValidatedInput.svelte";
import FormatPreviewField from "./components/FormatPreviewField.svelte";
import AppendLinkSetting from "./components/AppendLinkSetting.svelte";
import OpenFileSetting from "./components/OpenFileSetting.svelte";
import FileOpeningSetting from "./components/FileOpeningSetting.svelte";
import OnePageOverrideSetting from "./components/OnePageOverrideSetting.svelte";
import { suggester } from "./components/suggesterAction";
import { VALUE_SYNTAX } from "../../constants";
import { usesDefaultTemplateTitlePrompt } from "../../utils/templateNoteDiscoveryEligibility";

/**
 * Reactive replacement for TemplateChoiceBuilder.display(). Conditional rows are
 * {#if} blocks over the $state-backed choice proxy, so toggling a control updates
 * in place — no contentEl.empty()/display() teardown, no lost scroll/caret (#1130).
 */
let {
	choice = $bindable(),
	app,
	plugin,
}: {
	choice: ITemplateChoice;
	app: App;
	plugin: QuickAdd;
} = $props();

// Computed once from the stable app/plugin props ($derived satisfies the
// reactive-reference rule; the vault snapshot matches the imperative builder,
// which also read these once per render).
const templatePaths = $derived(plugin.getTemplateFiles().map((f) => f.path));
const allFolders = $derived(sortFolderPathsByTree(getAllFolderPathsInVault(app)));

function validateTemplatePath(
	raw: string,
): boolean | string | { valid: boolean; message?: string } {
	const value = raw.trim();
	if (!value) return true;
	// A path with format syntax (e.g. "Templates/{{value:type}} Template.md")
	// can only be resolved when the choice runs, so don't flag it "not found";
	// show a neutral hint instead (issue #620).
	if (hasTemplatePathSyntax(value)) {
		return { valid: true, message: "Contains format syntax — resolved at run time." };
	}
	// Resolve like the engine does at run time rather than requiring
	// suggestion-list membership: a template outside the configured folders
	// still runs fine and must not be flagged "not found" (master #1170/#1325).
	return getTemplateFile(app, value) !== null || "Template not found";
}

// --- File name format ----------------------------------------------------
const fileNameSuggesters = [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, true),
];
const discoverySupported = $derived(
	usesDefaultTemplateTitlePrompt(
		choice,
		choice.fileNameFormat.enabled
			? choice.fileNameFormat.format
			: VALUE_SYNTAX,
	),
);
const discoveryDescription = $derived(
	discoverySupported
		? "For the default note-title prompt, show matching notes first. Choosing one opens it unchanged; choosing the create row continues with this template."
		: "Only available when the file name prompt is the default note title: no custom format, {{VALUE}}, or {{NAME}}.",
);

// --- Folder selector -----------------------------------------------------
// The four persisted folder booleans encode mutually-exclusive destination
// modes; the dropdown is a derived view over them (no schema change). The mode
// mirrors TemplateChoiceEngine.getFolderPath() precedence — see folderMode.ts.
const folderMode = $derived(deriveFolderMode(choice.folder));
const folderModeDesc = $derived(folderModeDescriptions[folderMode]);
const needsFolderList = $derived(
	folderMode === "specified" && choice.folder.folders.length === 0,
);

function onFolderModeChange(value: string) {
	// Immutable reassignment so the nested change is reactive (in-place
	// choice.folder.x = ... would not retrigger the {#if} blocks).
	choice.folder = applyFolderMode(choice.folder, value as FolderMode);
}

let folderInputValue = $state("");
let folderSuggester: ExclusiveSuggester | undefined;

function attachFolderSuggester(el: HTMLInputElement | HTMLTextAreaElement) {
	folderSuggester = new ExclusiveSuggester(
		app,
		el,
		allFolders,
		choice.folder.folders,
	);
	return folderSuggester;
}

// Keep the exclusion set in sync with the current folder list (replaces the
// imperative updateCurrentItems() calls). Tolerates a destroyed suggester after
// the input unmounts on a mode switch — updateCurrentItems is field-only and the
// input is recreated (with a fresh suggester) when "specified" mode returns.
$effect(() => {
	folderSuggester?.updateCurrentItems(choice.folder.folders);
});

function addFolder() {
	const input = folderInputValue.trim();
	if (choice.folder.folders.some((folder) => folder === input)) {
		log.logWarning("cannot add same folder twice.");
		return;
	}
	choice.folder.folders.push(input);
	folderInputValue = "";
}

function deleteFolder(folder: string) {
	choice.folder.folders = choice.folder.folders.filter((f) => f !== folder);
}

function onFolderInputKeypress(event: KeyboardEvent) {
	if (event.key === "Enter") addFolder();
}

// --- File already exists -------------------------------------------------
const behaviorCategory = $derived(getBehaviorCategory(choice.fileExistsBehavior));
const showModeRow = $derived(
	behaviorCategory !== "prompt" && behaviorCategory !== "keep",
);
const modeOptions = $derived(
	getModesForCategory(behaviorCategory === "update" ? "update" : "create"),
);
const selectedMode = $derived(
	choice.fileExistsBehavior.kind === "apply"
		? choice.fileExistsBehavior.mode
		: modeOptions[0].id,
);

function onCategoryChange(value: string) {
	choice.fileExistsBehavior = getDefaultBehaviorForCategory(
		value as FileExistsBehaviorCategoryId,
		choice.fileExistsBehavior,
	);
}

function onModeChange(value: string) {
	choice.fileExistsBehavior = {
		kind: "apply",
		mode: value as FileExistsModeId,
	};
}
</script>

<ChoiceNameHeader bind:name={choice.name} {app} />

<SettingItem name="Template" heading />

<SettingItem name="Template Path" desc="Path to the Template." />
<ValidatedInput
	value={choice.templatePath}
	placeholder="Template path"
	{app}
	suggestions={templatePaths}
	maxSuggestions={50}
	validator={validateTemplatePath}
	ariaLabel="Template path"
	onChange={(value) => (choice.templatePath = value.trim())}
/>

<SettingItem name="File name format" desc="Set the file name format.">
	{#snippet control()}
		<Toggle bind:checked={choice.fileNameFormat.enabled} />
	{/snippet}
</SettingItem>
<FormatPreviewField
	value={choice.fileNameFormat.format}
	formatterKind="fileName"
	{app}
	{plugin}
/>
<ValidatedInput
	bind:value={choice.fileNameFormat.format}
	placeholder="File name format"
	disabled={!choice.fileNameFormat.enabled}
	makeSuggesters={fileNameSuggesters}
	ariaLabel="File name format"
/>

<SettingItem name="Location" heading />

<SettingItem name="New note location" desc={folderModeDesc}>
	{#snippet control()}
		<Dropdown
			value={folderMode}
			options={folderModeOptions}
			ariaLabel="New note location"
			onchange={onFolderModeChange}
		/>
	{/snippet}
</SettingItem>

{#if folderMode === "specified"}
	<div class="folderSelectionContainer">
		<div class="folderList">
			<FolderList folders={choice.folder.folders} {deleteFolder} />
		</div>
		<div class="folderInputContainer">
			<input
				type="text"
				class="qa-folder-path-input"
				placeholder="Folder path"
				aria-label="Folder path"
				bind:value={folderInputValue}
				onkeypress={onFolderInputKeypress}
				use:suggester={attachFolderSuggester}
			/>
			<button type="button" class="mod-cta" onclick={addFolder}>Add</button>
		</div>
	</div>

	{#if needsFolderList}
		<div class="qa-folder-mode-warning">
			Add at least one folder. With none, the note falls back to the active
			file's folder (or you'll be prompted to pick one if no file is open).
		</div>
	{/if}

	<SettingItem
		name="Include subfolders"
		desc="Get prompted to choose from both the selected folders and their subfolders when creating the note."
	>
		{#snippet control()}
			<Toggle bind:checked={choice.folder.chooseFromSubfolders} />
		{/snippet}
	</SettingItem>
{/if}

<SettingItem name="Linking" heading />
<AppendLinkSetting bind:appendLink={choice.appendLink} fileLabel="created" />
<SettingItem
	name="Copy link to clipboard"
	desc="Copy a link to the created file after the Template choice runs."
>
	{#snippet control()}
		<Toggle
			checked={choice.copyLinkToClipboard ?? false}
			onchange={(value) => (choice.copyLinkToClipboard = value)}
		/>
	{/snippet}
</SettingItem>

<SettingItem name="Behavior" heading />

<SettingItem
	name="Search existing notes before creating"
	desc={discoveryDescription}
>
	{#snippet control()}
		<Toggle
			checked={choice.discoverExistingNotesBeforeCreate ?? false}
			disabled={!discoverySupported}
			onchange={(value) => (choice.discoverExistingNotesBeforeCreate = value)}
		/>
	{/snippet}
</SettingItem>

<SettingItem
	name="If the target file already exists"
	desc="Choose whether QuickAdd should ask what to do, update the existing file, create another file, or keep the existing file."
>
	{#snippet control()}
		<Dropdown
			value={behaviorCategory}
			options={fileExistsBehaviorCategoryOptions.map((o) => ({
				value: o.id,
				label: o.label,
			}))}
			onchange={onCategoryChange}
		/>
	{/snippet}
</SettingItem>

{#if showModeRow}
	<SettingItem
		name={behaviorCategory === "update" ? "Update action" : "New file naming"}
		desc={getFileExistsMode(selectedMode).description}
	>
		{#snippet control()}
			<Dropdown
				value={selectedMode}
				options={modeOptions.map((mode) => ({
					value: mode.id,
					label: mode.label,
				}))}
				onchange={onModeChange}
			/>
		{/snippet}
	</SettingItem>
{/if}

<OpenFileSetting bind:openFile={choice.openFile} description="Open the created file." />
{#if choice.openFile}
	<FileOpeningSetting bind:fileOpening={choice.fileOpening} contextLabel="created" />
{/if}

<OnePageOverrideSetting bind:onePageInput={choice.onePageInput} />
