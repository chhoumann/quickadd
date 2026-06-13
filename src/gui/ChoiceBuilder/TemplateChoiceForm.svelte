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
import { sortFolderPathsByTree } from "../../utils/folder-sorting";
import { ExclusiveSuggester } from "../suggesters/exclusiveSuggester";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import FolderList from "./FolderList.svelte";
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

function validateTemplatePath(raw: string): boolean | string {
	const value = raw.trim();
	if (!value) return true;
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

// --- Folder selector -----------------------------------------------------
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
// imperative updateCurrentItems() calls).
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

<SettingItem
	name="Create in folder"
	desc="Create the file in the specified folder. If multiple folders are specified, you will be prompted for which folder to create the file in."
>
	{#snippet control()}
		<Toggle bind:checked={choice.folder.enabled} />
	{/snippet}
</SettingItem>

{#if choice.folder.enabled}
	{#if !choice.folder.createInSameFolderAsActiveFile}
		<SettingItem name="Choose folder when creating a new note">
			{#snippet control()}
				<Toggle bind:checked={choice.folder.chooseWhenCreatingNote} />
			{/snippet}
		</SettingItem>

		{#if !choice.folder.chooseWhenCreatingNote}
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

	{#if !choice.folder.chooseWhenCreatingNote}
		<SettingItem
			name="Create in same folder as active file"
			desc="Creates the file in the same folder as the currently active file. Will not create the file if there is no active file."
		>
			{#snippet control()}
				<Toggle bind:checked={choice.folder.createInSameFolderAsActiveFile} />
			{/snippet}
		</SettingItem>
	{/if}
{/if}

<SettingItem name="Linking" heading />
<AppendLinkSetting bind:appendLink={choice.appendLink} fileLabel="created" />

<SettingItem name="Behavior" heading />

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
