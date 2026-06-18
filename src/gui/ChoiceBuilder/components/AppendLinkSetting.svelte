<script lang="ts">
import { TFile, type App } from "obsidian";
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import type {
	AppendLinkOptions,
	LinkPlacement,
	LinkType,
} from "../../../types/linkPlacement";
import {
	normalizeAppendLinkOptions,
	placementSupportsEmbed,
} from "../../../types/linkPlacement";
import { normalizeAppendLinkDestinationPath } from "../../../utils/fileLinks";

/**
 * Shared append-link configuration — collapses the near-identical
 * addAppendLinkSetting from captureChoiceBuilder and templateChoiceBuilder.
 * Conditional placement / link-type rows are reactive `{#if}` blocks; the old
 * `reload()` calls are gone (whole-value reassignment drives re-render).
 */
let {
	appendLink = $bindable(),
	fileLabel,
	app = undefined,
}: {
	appendLink: boolean | AppendLinkOptions;
	fileLabel: "captured" | "created";
	app?: App | undefined;
} = $props();

type AppendLinkMode = "required" | "optional" | "disabled";
type AppendLinkDestinationMode = "activeFile" | "specifiedFile";

const normalized = $derived(normalizeAppendLinkOptions(appendLink));
const normalizedLinkType = $derived(normalized.linkType ?? "link");
const destinationPath = $derived(
	normalized.destination.type === "specifiedFile"
		? normalized.destination.path
		: "",
);
const currentMode = $derived(
	normalized.enabled
		? normalized.requireActiveFile
			? "required"
			: "optional"
		: "disabled",
);
const destinationMode = $derived(normalized.destination.type);
const markdownFilePaths = $derived(
	app ? app.vault.getMarkdownFiles().map((file) => file.path) : [],
);

const modeOptions = [
	{ value: "required", label: "Enabled (strict)" },
	{ value: "optional", label: "Enabled (skip if unavailable)" },
	{ value: "disabled", label: "Disabled" },
];
const destinationOptions = [
	{ value: "activeFile", label: "Current note" },
	{ value: "specifiedFile", label: "Specified note" },
];
const placementOptions = [
	{ value: "replaceSelection", label: "Replace selection" },
	{ value: "afterSelection", label: "After selection" },
	{ value: "endOfLine", label: "End of line" },
	{ value: "newLine", label: "New line" },
];
const linkTypeOptions = [
	{ value: "link", label: "Link" },
	{ value: "embed", label: "Embed" },
];

function onModeChange(value: string) {
	switch (value as AppendLinkMode) {
		case "disabled":
			appendLink = false;
			break;
		case "required":
			appendLink = {
				enabled: true,
				placement: normalized.placement,
				requireActiveFile: true,
				linkType: normalizedLinkType,
				destination: normalized.destination,
			};
			break;
		case "optional":
			appendLink = {
				enabled: true,
				placement: normalized.placement,
				requireActiveFile: false,
				linkType: normalizedLinkType,
				destination: normalized.destination,
			};
			break;
	}
}

function onPlacementChange(value: string) {
	const placement = value as LinkPlacement;
	const current = appendLink;
	const requireActiveFile =
		typeof current === "boolean"
			? normalized.requireActiveFile
			: current.requireActiveFile;
	const previousLinkType =
		typeof current === "boolean"
			? normalizedLinkType
			: current.linkType ?? normalizedLinkType;
	const nextLinkType = placementSupportsEmbed(placement)
		? previousLinkType
		: "link";
	appendLink = {
		enabled: true,
		placement,
		requireActiveFile,
		linkType: nextLinkType,
		destination: normalized.destination,
	};
}

function onLinkTypeChange(value: string) {
	const current = appendLink;
	const requireActiveFile =
		typeof current === "boolean"
			? normalized.requireActiveFile
			: current.requireActiveFile;
	const placement =
		typeof current === "boolean" ? normalized.placement : current.placement;
	appendLink = {
		enabled: true,
		placement,
		requireActiveFile,
		linkType: value as LinkType,
		destination: normalized.destination,
	};
}

function onDestinationChange(value: string) {
	const destination =
		(value as AppendLinkDestinationMode) === "specifiedFile"
			? { type: "specifiedFile" as const, path: destinationPath }
			: { type: "activeFile" as const };
	appendLink = {
		enabled: true,
		placement: normalized.placement,
		requireActiveFile: normalized.requireActiveFile,
		linkType: destination.type === "specifiedFile" ? "link" : normalizedLinkType,
		destination,
	};
}

function onDestinationPathChange(value: string) {
	appendLink = {
		enabled: true,
		placement: normalized.placement,
		requireActiveFile: normalized.requireActiveFile,
		linkType: "link",
		destination: { type: "specifiedFile", path: value.trim() },
	};
}

function validateDestinationFile(raw: string) {
	const value = raw.trim();
	if (!value) return "Destination file is required";
	if (!app) return true;

	const target = app.vault.getAbstractFileByPath(
		normalizeAppendLinkDestinationPath(value),
	);
	return target instanceof TFile && target.extension === "md"
		? true
		: "Markdown file not found";
}
</script>

<SettingItem
	name={`Link to ${fileLabel} file`}
	desc={`Choose whether QuickAdd should insert a link to the ${fileLabel} file.`}
>
	{#snippet control()}
		<Dropdown value={currentMode} options={modeOptions} onchange={onModeChange} />
	{/snippet}
</SettingItem>

{#if currentMode !== "disabled"}
	<SettingItem
		name="Link destination"
		desc={`Where QuickAdd writes the link to the ${fileLabel} file.`}
	>
		{#snippet control()}
			<Dropdown
				value={destinationMode}
				options={destinationOptions}
				onchange={onDestinationChange}
			/>
		{/snippet}
	</SettingItem>

	{#if destinationMode === "activeFile"}
		<SettingItem
			name="Link placement"
			desc="Where to place the link when appending"
		>
			{#snippet control()}
				<Dropdown
					value={normalized.placement}
					options={placementOptions}
					onchange={onPlacementChange}
				/>
			{/snippet}
		</SettingItem>

		{#if placementSupportsEmbed(normalized.placement)}
			<SettingItem
				name="Link type"
				desc="Choose whether replacing the selection inserts a link or an embed."
			>
				{#snippet control()}
					<Dropdown
						value={normalizedLinkType}
						options={linkTypeOptions}
						onchange={onLinkTypeChange}
					/>
				{/snippet}
			</SettingItem>
		{/if}
	{:else}
		<SettingItem
			name="Destination file"
			desc="Existing Markdown note that receives the link at the bottom."
		>
			{#snippet control()}
				<ValidatedInput
					value={destinationPath}
					placeholder="Index.md"
					{app}
					suggestions={markdownFilePaths}
					maxSuggestions={50}
					required
					requiredMessage="Destination file is required"
					validator={validateDestinationFile}
					ariaLabel="Append link destination file"
					onChange={onDestinationPathChange}
				/>
			{/snippet}
		</SettingItem>
	{/if}
{/if}
