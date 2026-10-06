<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { getTemplateFile } from "../../utils/templateFolderUtils";
import { hasTemplatePathSyntax } from "../../utils/templatePathSyntax";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
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
import type { Step } from "../../v3/model";
import CaptureTargetSetting from "./components/CaptureTargetSetting.svelte";
import WritePositionSetting from "./components/WritePositionSetting.svelte";
import ChoiceIconSetting from "./components/ChoiceIconSetting.svelte";
import ChoiceSummary from "./components/ChoiceSummary.svelte";
import MoreSettings from "./components/MoreSettings.svelte";

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
	onAddStep = undefined,
}: {
	choice: ICaptureChoice;
	app: App;
	plugin: QuickAdd;
	onAddStep?: (step: Step) => void;
} = $props();

const templateFilePaths = $derived(
	plugin.getTemplateFiles().map((f) => f.path),
);
const formatSuggestContext = $derived(choice.propertyCapture ? "propertyValue" : "noteContent");
const formatSuggesters = $derived.by(() => {
	const context = formatSuggestContext;
	return [
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, context),
	];
});

function validateTemplate(
	raw: string,
): boolean | string | { valid: boolean; message?: string } {
	const value = raw.trim();
	if (!value) return true;
	// A path with format syntax (e.g. "Templates/{{value:type}} Template.md")
	// only resolves when the capture runs, so show a neutral hint rather than
	// flagging it "not found" (issue #620).
	if (hasTemplatePathSyntax(value)) {
		return { valid: true, message: "Contains format syntax — resolved at run time." };
	}
	// Resolve like the engine does at run time rather than requiring
	// suggestion-list membership (templates outside the configured folders are
	// valid). Mirrors templateChoiceBuilder (master #1170/#1325).
	return getTemplateFile(app, value) !== null || "Template not found";
}

// An empty format captures {{VALUE}} on its own; `enabled` just mirrors whether
// there is text, so choices saved with the old toggle keep working.
const captureFormat = $derived(choice.format.enabled ? choice.format.format : "");

const selectionOptions = [
	{ value: "", label: "Follow global setting" },
	{ value: "enabled", label: "Use selection" },
	{ value: "disabled", label: "Ignore selection" },
];
const selectionOverride = $derived(
	typeof choice.useSelectionAsCaptureValue === "boolean"
		? choice.useSelectionAsCaptureValue
			? "enabled"
			: "disabled"
		: "",
);

function onSelectionChange(value: string) {
	if (value === "") {
		choice.useSelectionAsCaptureValue = undefined;
		return;
	}
	choice.useSelectionAsCaptureValue = value === "enabled";
}

function onTemplaterAfterCaptureChange(value: boolean) {
	if (!choice.templater) choice.templater = {};
	choice.templater.afterCapture = value ? "wholeFile" : "none";
}
</script>

<ChoiceSummary {choice} />

<SettingGroup>
	<CaptureTargetSetting bind:choice {app} {plugin} />

	<WritePositionSetting bind:choice {app} {plugin} />

	<LabeledField
		name="What"
		desc={"Leave empty to capture {{VALUE}} on its own - what you type at the prompt, or the current selection."}
	>
		{#snippet control()}
			{#if !choice.propertyCapture}
				<span class="qaInlineToggle">
					<span aria-hidden="true">Task</span>
					<Toggle bind:checked={choice.task} ariaLabel="Task" />
				</span>
			{/if}
		{/snippet}
		{#snippet children(id)}
			{#key formatSuggestContext}
				<ValidatedInput
					{id}
					inputKind="textarea"
					bind:value={
						() => captureFormat,
						(value) => (choice.format = { enabled: value.trim() !== "", format: value })
					}
					placeholder={choice.propertyCapture?.action === "addToList" ? "One item per line" : "{{VALUE}}"}
					makeSuggesters={formatSuggesters}
				/>
			{/key}
			<FormatTokenHint value={captureFormat} />
			<FormatPreviewField value={captureFormat} {app} {plugin} />
		{/snippet}
	</LabeledField>
</SettingGroup>

<InputsSection {choice} {app} />

<StepsSection {choice} {onAddStep} />

<MoreSettings {choice}>
	{#if !choice.captureToActiveFile}
		<SettingGroup heading="Location">
			<SettingItem name="Create note if it doesn't exist">
				{#snippet control()}
					<Toggle bind:checked={choice.createFileIfItDoesntExist.enabled} />
				{/snippet}
			</SettingItem>

			{#if choice.createFileIfItDoesntExist.enabled}
				<LabeledField
					name="Create note with a template"
					desc="Path to the template QuickAdd applies to the new note."
					bodyVisible={choice.createFileIfItDoesntExist.createWithTemplate}
				>
					{#snippet control()}
						<Toggle
							bind:checked={choice.createFileIfItDoesntExist.createWithTemplate}
						/>
					{/snippet}
					{#snippet children(id)}
						<ValidatedInput
							{id}
							value={choice.createFileIfItDoesntExist.template}
							placeholder="Template path"
							{app}
							suggestions={templateFilePaths}
							maxSuggestions={50}
							validator={validateTemplate}
							onChange={(value) =>
								(choice.createFileIfItDoesntExist.template = value.trim())}
						/>
					{/snippet}
				</LabeledField>
			{/if}
		</SettingGroup>
	{/if}

	<SettingGroup heading="Linking">
		<AppendLinkSetting bind:appendLink={choice.appendLink} fileLabel="captured" {app} />
		<SettingItem
			name="Copy link to clipboard"
			desc="Copy a link to the captured note after the Capture choice runs."
		>
			{#snippet control()}
				<Toggle
					checked={choice.copyLinkToClipboard ?? false}
					onchange={(value) => (choice.copyLinkToClipboard = value)}
				/>
			{/snippet}
		</SettingItem>
	</SettingGroup>

	{#if !choice.propertyCapture}
		<SettingGroup heading="Content">
			<SettingItem name="One entry per line" desc={"Writes the format once for each line of {{VALUE}}."}>
				{#snippet control()}
					<Toggle
						checked={choice.eachLine ?? false}
						onchange={(value) => (choice.eachLine = value)}
					/>
				{/snippet}
			</SettingItem>
		</SettingGroup>
	{/if}

	<SettingGroup heading="Behavior">
		{#if !choice.captureToActiveFile}
			<OpenFileSetting bind:openFile={choice.openFile} description="Open the captured note." />
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

		<!-- Deprecated (#2014): shown only to choices that already have it on, so they
		     can turn it off. -->
		{#if !choice.propertyCapture && choice.templater?.afterCapture === "wholeFile"}
		<SettingItem
			name="Run Templater on entire destination note after capture (deprecated)"
			desc="Will be removed in a future release. QuickAdd already runs Templater in what it captures. This also runs every <% %> elsewhere in the destination note, including inside code blocks."
		>
			{#snippet control()}
				<Toggle
					checked={choice.templater?.afterCapture === "wholeFile"}
					onchange={onTemplaterAfterCaptureChange}
				/>
			{/snippet}
		</SettingItem>
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

<style>
	.qaInlineToggle {
		display: inline-flex;
		align-items: center;
		gap: var(--size-4-2);
		color: var(--text-muted);
		font-size: var(--font-ui-small);
	}
</style>
