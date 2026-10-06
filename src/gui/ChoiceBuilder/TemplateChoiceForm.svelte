<script lang="ts">
import { onDestroy } from "svelte";
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
	existingNoteActions,
} from "../../template/fileExistsPolicy";
import { log } from "../../logger/logManager";
import { getAllFolderPathsInVault } from "../../utils/vaultQueries";
import { getTemplateFile } from "../../utils/templateFolderUtils";
import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";
import { sortFolderPathsByTree } from "../../utils/folder-sorting";
import { ExclusiveSuggester } from "../suggesters/exclusiveSuggester";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import FolderList from "./FolderList.svelte";
import {
	applyFolderMode,
	deriveFolderMode,
	isSingleFolder,
	withSingleFolder,
	folderModeDescriptions,
	folderModeOptions,
	type FolderMode,
} from "./folderMode";
import SettingItem from "../components/SettingItem.svelte";
import SettingGroup from "../components/SettingGroup.svelte";
import Toggle from "../components/Toggle.svelte";
import Dropdown from "../components/Dropdown.svelte";
import ValidatedInput from "./components/ValidatedInput.svelte";
import LabeledField from "./components/LabeledField.svelte";
import FormatPreviewField from "./components/FormatPreviewField.svelte";
import FormatTokenHint from "./components/FormatTokenHint.svelte";
import AppendLinkSetting from "./components/AppendLinkSetting.svelte";
import OpenFileSetting from "./components/OpenFileSetting.svelte";
import FileOpeningSetting from "./components/FileOpeningSetting.svelte";
import OnePageOverrideSetting from "./components/OnePageOverrideSetting.svelte";
import DateOriginSetting from "./components/DateOriginSetting.svelte";
import CommandPaletteSetting from "./components/CommandPaletteSetting.svelte";
import RibbonSetting from "./components/RibbonSetting.svelte";
import StepsSection from "./components/StepsSection.svelte";
import InputsSection from "./components/InputsSection.svelte";
import TemplaterBadge from "./components/TemplaterBadge.svelte";
import { getTemplater } from "../../utils/templaterIntegration";
import { usesTemplater } from "../../v3/templater";
import type { Step } from "../../v3/model";
import ChoiceIconSetting from "./components/ChoiceIconSetting.svelte";
import ChoiceSummary from "./components/ChoiceSummary.svelte";
import MoreSettings from "./components/MoreSettings.svelte";
import { newTemplate } from "./newTemplate";
import { suggester } from "./components/suggesterAction";
import { VALUE_SYNTAX } from "../../constants";
import { usesDefaultTemplateTitlePrompt } from "../../utils/templateNoteDiscoveryEligibility";
import { likelyTargetFolderPath } from "../../utils/previewTargetFolder";

/**
 * Reactive replacement for TemplateChoiceBuilder.display(). Conditional rows are
 * {#if} blocks over the $state-backed choice proxy, so toggling a control updates
 * in place — no contentEl.empty()/display() teardown, no lost scroll/caret (#1130).
 */
let {
	choice = $bindable(),
	app,
	plugin,
	commitPending = $bindable(),
	onAddStep = undefined,
}: {
	choice: ITemplateChoice;
	app: App;
	plugin: QuickAdd;
	/** Set by the form: adds a folder typed but not added (see ChoiceFormProps). */
	commitPending?: () => void;
	onAddStep?: (step: Step) => void;
} = $props();

// Computed once from the stable app/plugin props ($derived satisfies the
// reactive-reference rule; the vault snapshot matches the imperative builder,
// which also read these once per render).
// Read again once New template… adds one.
let templatesAdded = $state(0);
const templatePaths = $derived.by(() => {
	void templatesAdded;
	return plugin.getTemplateFiles().map((f) => f.path);
});
const offerNewTemplate = $derived(templatePaths.length === 0 || !choice.templatePath.trim());

async function onNewTemplate() {
	const path = await newTemplate(app, plugin.settings.templateFolderPaths);
	if (!path) return;
	choice.templatePath = path;
	templatesAdded++;
}
const allFolders = $derived(sortFolderPathsByTree(getAllFolderPathsInVault(app)));

// Whether the chosen template has Templater tags, read again when the Template field changes.
let templateUsesTemplater = $state(false);
$effect(() => {
	const file = getTemplateFile(app, choice.templatePath);
	let current = true;
	templateUsesTemplater = false;
	if (!file) return;
	app.vault.cachedRead(file).then(
		(text) => {
			if (current) templateUsesTemplater = usesTemplater(text);
		},
		() => {},
	);
	return () => {
		current = false;
	};
});
const templaterInstalled = $derived(Boolean(getTemplater(app)));

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
// An empty field is the default note-title prompt; `enabled` just mirrors
// whether there is text, so choices saved with the old toggle keep working.
const fileName = $derived(choice.fileNameFormat.enabled ? choice.fileNameFormat.format : "");
const fileNameSuggesters = [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, "fileName"),
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
		? "Show matching notes and unresolved links in the note-title prompt."
		: "Only available when the note name asks for the note title: empty, {{VALUE}}, or {{NAME}}.",
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

// The Folder field: one folder, or Obsidian's default location when empty.
const singleFolder = $derived(isSingleFolder(choice.folder));
const singleFolderPath = $derived(folderMode === "specified" ? (choice.folder.folders[0] ?? "") : "");

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
	// An empty entry resolves to the vault root at run time and renders as an
	// invisible blank row, while silently suppressing the "add a folder" warning.
	// Treat a blank Add as a no-op.
	if (!input) return;
	if (choice.folder.folders.some((folder) => folder === input)) {
		log.logWarning("cannot add same folder twice.");
		return;
	}
	choice.folder.folders.push(input);
	folderInputValue = "";
}

function onFolderInputKeypress(event: KeyboardEvent) {
	if (event.key === "Enter") addFolder();
}

// A folder typed but never added is kept instead of dropped (#1993): when the
// builder saves in place (the app going to the background), and when the page
// is left, which destroys this form before the builder reads the choice.
function addPendingFolder() {
	if (folderMode === "specified") addFolder();
}
commitPending = addPendingFolder;
onDestroy(addPendingFolder);

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

<ChoiceSummary {choice} runsTemplater={templateUsesTemplater && templaterInstalled} />

<SettingGroup>
	<LabeledField name="Template">
		{#snippet control()}
			{#if offerNewTemplate}
				<button type="button" class="qaNewTemplateButton" onclick={onNewTemplate}>New template…</button>
			{/if}
		{/snippet}
		{#snippet children(id)}
			<ValidatedInput
				{id}
				value={choice.templatePath}
				placeholder="Template path"
				{app}
				suggestions={templatePaths}
				maxSuggestions={50}
				validator={validateTemplatePath}
				onChange={(value) => (choice.templatePath = value.trim())}
			/>
			{#if templateUsesTemplater}
				<TemplaterBadge installed={templaterInstalled} />
			{/if}
		{/snippet}
	</LabeledField>

	{#if singleFolder}
		<LabeledField name="Folder">
			{#snippet children(id)}
				<ValidatedInput
					{id}
					value={singleFolderPath}
					placeholder="Default location for new notes"
					{app}
					suggestions={allFolders}
					onChange={(value) => (choice.folder = withSingleFolder(choice.folder, value.trim()))}
				/>
			{/snippet}
		</LabeledField>
	{/if}

	<LabeledField
		name="Note name"
		desc="Leave empty to ask for the note title."
	>
		{#snippet children(id)}
			<ValidatedInput
				{id}
				bind:value={
					() => fileName,
					(value) => (choice.fileNameFormat = { enabled: value.trim() !== "", format: value })
				}
				placeholder={"{{VALUE}}"}
				makeSuggesters={fileNameSuggesters}
			/>
			<FormatTokenHint value={fileName} />
			<FormatPreviewField
				value={fileName}
				formatterKind="fileName"
				targetFolderPath={likelyTargetFolderPath(choice.folder)}
				{app}
				{plugin}
			/>
		{/snippet}
	</LabeledField>
</SettingGroup>

<InputsSection {choice} {app} />

<StepsSection {choice} {onAddStep} />

{#snippet folderSelection()}
	<div class="folderSelectionContainer">
		<div class="folderList">
			<FolderList
				folders={choice.folder.folders}
				onChange={(next) => (choice.folder.folders = next)}
			/>
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
{/snippet}

<MoreSettings {choice}>
	<SettingGroup heading="Location">
		<!-- The folders are part of the row that picks them, so a settings page's
		     Tab order runs from the dropdown through them. -->
		<SettingItem
			name="New note location"
			desc={folderModeDesc}
			body={folderMode === "specified" ? folderSelection : undefined}
		>
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
			<SettingItem
				name="Include subfolders"
				desc="Get prompted to choose from both the selected folders and their subfolders when creating the note."
			>
				{#snippet control()}
					<Toggle bind:checked={choice.folder.chooseFromSubfolders} />
				{/snippet}
			</SettingItem>
		{/if}
	</SettingGroup>

	<SettingGroup heading="Linking">
		<AppendLinkSetting bind:appendLink={choice.appendLink} fileLabel="created" {app} />
		<SettingItem
			name="Copy link to clipboard"
			desc="Copy a link to the created note after the Template choice runs."
		>
			{#snippet control()}
				<Toggle
					checked={choice.copyLinkToClipboard ?? false}
					onchange={(value) => (choice.copyLinkToClipboard = value)}
				/>
			{/snippet}
		</SettingItem>
	</SettingGroup>

	<SettingGroup heading="Behavior">
		<SettingItem
			name="Search existing notes before creating"
			desc={discoveryDescription}
		>
			{#snippet control()}
				<!-- When discovery is unsupported (custom file-name format) the engine
				     ignores the stored flag, so show the toggle as off to match the
				     runtime behavior rather than a misleading checked-but-greyed state. -->
				<Toggle
					checked={discoverySupported
						? (choice.discoverExistingNotesBeforeCreate ?? false)
						: false}
					disabled={!discoverySupported}
					onchange={(value) => (choice.discoverExistingNotesBeforeCreate = value)}
				/>
			{/snippet}
		</SettingItem>

		{#if discoverySupported && choice.discoverExistingNotesBeforeCreate}
			<SettingItem name="When selecting an existing note">
				{#snippet control()}
					<Dropdown
						value={choice.existingNoteAction ?? "open"}
						options={existingNoteActions.map((action) => ({ value: action.id, label: action.label }))}
						onchange={(value) => {
							const action = existingNoteActions.find((action) => action.id === value);
							if (action) choice.existingNoteAction = action.id;
						}}
					/>
				{/snippet}
			</SettingItem>
		{/if}

		<SettingItem
			name={discoverySupported && choice.discoverExistingNotesBeforeCreate
				? "If a new note's path already exists"
				: "If the note already exists"}
			desc="Choose whether QuickAdd should ask what to do, update the existing note, create another note, or keep the existing note."
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
				name={behaviorCategory === "update" ? "Update action" : "New note naming"}
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

		<OpenFileSetting bind:openFile={choice.openFile} description="Open the created note." />
		{#if choice.openFile}
			<FileOpeningSetting bind:fileOpening={choice.fileOpening} contextLabel="created" />
		{/if}

		<DateOriginSetting bind:dateOrigin={choice.dateOrigin} />

		<OnePageOverrideSetting bind:onePageInput={choice.onePageInput} />

		<CommandPaletteSetting
			bind:command={choice.command}
			bind:pickDayCommand={choice.pickDayCommand}
			name={choice.name}
			dateOrigin={choice.dateOrigin}
		/>

		<RibbonSetting choiceId={choice.id} />

		<ChoiceIconSetting bind:icon={choice.icon} type={choice.type} {app} />
	</SettingGroup>
</MoreSettings>
