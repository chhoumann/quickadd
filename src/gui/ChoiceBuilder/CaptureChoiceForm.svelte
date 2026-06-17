<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { getTemplateFile } from "../../utilityObsidian";
import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
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
import CaptureTargetSetting from "./components/CaptureTargetSetting.svelte";
import WritePositionSetting from "./components/WritePositionSetting.svelte";

/**
 * Reactive replacement for CaptureChoiceBuilder.display(). Every conditional row
 * (capture target, create-if-missing, write position + insert-after/before fields,
 * append link, file opening) is an {#if} over the $state choice proxy, so toggling
 * a control updates in place — no contentEl.empty()/display() teardown (#1130).
 */
let {
	choice = $bindable(),
	app,
	plugin,
}: {
	choice: ICaptureChoice;
	app: App;
	plugin: QuickAdd;
} = $props();

if (!choice.format) {
	choice.format = {
		enabled: false,
		format: "",
		source: "inline",
		filePath: "",
	};
}
if (choice.format.source !== "file") {
	choice.format.source = "inline";
}
if (typeof choice.format.filePath !== "string") {
	choice.format.filePath = "";
}

const templateFilePaths = $derived(
	plugin.getTemplateFiles().map((f) => f.path),
);
const formatSuggesters = [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin),
];

function validateTemplate(
	raw: string,
): boolean | string | { valid: boolean; message?: string } {
	const value = raw.trim();
	if (!value) return true;
	// A path with format syntax (e.g. "Templates/{{value:type}} Template.md")
	// only resolves when the capture runs, so show a neutral hint rather than
	// flagging it "not found" (issue #620).
if (hasTemplatePathSyntax(value)) {
		return {
			valid: true,
			message: "Contains format syntax — resolved at run time.",
		};
	}
	// Resolve like the engine does at run time rather than requiring
	// suggestion-list membership (templates outside the configured folders are
	// valid). Mirrors templateChoiceBuilder (master #1170/#1325).
	return getTemplateFile(app, value) !== null || "Template not found";
}

const selectionOptions = [
	{ value: "", label: "Follow global setting" },
	{ value: "enabled", label: "Use selection" },
	{ value: "disabled", label: "Ignore selection" },
];
const formatSourceOptions = [
	{ value: "inline", label: "Inline format" },
	{ value: "file", label: "File" },
];
const selectionOverride = $derived(
	typeof choice.useSelectionAsCaptureValue === "boolean"
		? choice.useSelectionAsCaptureValue
			? "enabled"
			: "disabled"
		: "",
);
const formatSource = $derived(
	choice.format.source === "file" ? "file" : "inline",
);

function onSelectionChange(value: string) {
	if (value === "") {
		choice.useSelectionAsCaptureValue = undefined;
		return;
	}
	choice.useSelectionAsCaptureValue = value === "enabled";
}

function validateCaptureFormatFile(
	raw: string,
): boolean | string | { valid: boolean; message?: string } {
	const value = raw.trim();
	if (!value) return true;
	if (hasTemplatePathSyntax(value)) {
		return {
			valid: true,
			message: "Contains format syntax — resolved at run time.",
		};
	}
	return getTemplateFile(app, value) !== null || "Capture format file not found";
}

function onFormatSourceChange(value: string) {
	choice.format.source = value === "file" ? "file" : "inline";
}

function onTemplaterAfterCaptureChange(value: boolean) {
	if (!choice.templater) choice.templater = {};
	choice.templater.afterCapture = value ? "wholeFile" : "none";
}
</script>

<ChoiceNameHeader bind:name={choice.name} {app} />

<SettingItem name="Location" heading />
<CaptureTargetSetting bind:choice {app} {plugin} />

{#if !choice.captureToActiveFile}
	<SettingItem name="Create file if it doesn't exist">
		{#snippet control()}
			<Toggle bind:checked={choice.createFileIfItDoesntExist.enabled} />
		{/snippet}
	</SettingItem>

	{#if choice.createFileIfItDoesntExist.enabled}
		<SettingItem name="Create file with given template.">
			{#snippet control()}
				<Toggle
					bind:checked={choice.createFileIfItDoesntExist.createWithTemplate}
				/>
			{/snippet}
		</SettingItem>
		<ValidatedInput
			value={choice.createFileIfItDoesntExist.template}
			placeholder="Template path"
			disabled={!choice.createFileIfItDoesntExist.createWithTemplate}
			{app}
			suggestions={templateFilePaths}
			maxSuggestions={50}
			validator={validateTemplate}
			ariaLabel="Template path"
			onChange={(value) =>
				(choice.createFileIfItDoesntExist.template = value.trim())}
		/>
	{/if}
{/if}

<SettingItem name="Position" heading />
<WritePositionSetting bind:choice {app} {plugin} />

<SettingItem name="Linking" heading />
<AppendLinkSetting bind:appendLink={choice.appendLink} fileLabel="captured" />

<SettingItem name="Content" heading />
<SettingItem name="Task" desc="Formats the value as a task.">
	{#snippet control()}
		<Toggle bind:checked={choice.task} />
	{/snippet}
</SettingItem>

<SettingItem name="Capture format" desc="Set the format of the capture.">
	{#snippet control()}
		<Toggle bind:checked={choice.format.enabled} />
	{/snippet}
</SettingItem>
{#if choice.format.enabled}
	<SettingItem
		name="Capture format source"
		desc="Choose whether the format is written here or loaded from a vault file."
	>
		{#snippet control()}
			<Dropdown
				value={formatSource}
				options={formatSourceOptions}
				onchange={onFormatSourceChange}
			/>
		{/snippet}
	</SettingItem>
	{#if formatSource === "file"}
		<ValidatedInput
			bind:value={choice.format.filePath}
			placeholder="Capture format file path"
			{app}
			suggestions={templateFilePaths}
			maxSuggestions={50}
			validator={validateCaptureFormatFile}
			required={true}
			requiredMessage="Capture format file is required"
			ariaLabel="Capture format file"
		/>
	{:else}
		<FormatPreviewField value={choice.format.format} {app} {plugin} />
		<ValidatedInput
			inputKind="textarea"
			bind:value={choice.format.format}
			placeholder="Format"
			required={true}
			requiredMessage="Capture format is required when enabled"
			makeSuggesters={formatSuggesters}
			ariaLabel="Format"
		/>
	{/if}
{:else}
	<FormatPreviewField value={choice.format.format} {app} {plugin} />
	<ValidatedInput
		inputKind="textarea"
		bind:value={choice.format.format}
		placeholder="Format"
		disabled={true}
		makeSuggesters={formatSuggesters}
		ariaLabel="Format"
	/>
{/if}

<SettingItem name="Behavior" heading />
{#if !choice.captureToActiveFile}
	<OpenFileSetting bind:openFile={choice.openFile} description="Open the captured file." />
	{#if choice.openFile}
		<FileOpeningSetting bind:fileOpening={choice.fileOpening} contextLabel="captured" />
	{/if}
{/if}

<SettingItem
	name="Use editor selection as default value"
	desc={"Controls whether this Capture uses the current editor selection as {{VALUE}}. Does not affect {{SELECTED}}."}
>
	{#snippet control()}
		<Dropdown
			value={selectionOverride}
			options={selectionOptions}
			onchange={onSelectionChange}
		/>
	{/snippet}
</SettingItem>

<SettingItem
	name="Run Templater on entire destination file after capture"
	desc="Advanced / legacy: this executes any <% %> anywhere in the destination file (including inside code blocks)."
>
	{#snippet control()}
		<Toggle
			checked={choice.templater?.afterCapture === "wholeFile"}
			onchange={onTemplaterAfterCaptureChange}
		/>
	{/snippet}
</SettingItem>

<OnePageOverrideSetting bind:onePageInput={choice.onePageInput} />
