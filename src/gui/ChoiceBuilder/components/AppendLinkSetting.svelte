<script lang="ts">
import { TFile, type App } from "obsidian";
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import type {
	AppendLinkOptions,
	FrontmatterHandling,
	LinkDisplayText,
	LinkPlacement,
	LinkType,
} from "../../../types/linkPlacement";
import {
	DEFAULT_FRONTMATTER_HANDLING,
	normalizeAppendLinkOptions,
	placementSupportsEmbed,
	placementSupportsFrontmatter,
	placementSupportsSelectionAlias,
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
const normalizedDisplayText = $derived(normalized.displayText);
const normalizedFrontmatterHandling = $derived(
	normalized.frontmatterHandling ?? DEFAULT_FRONTMATTER_HANDLING,
);
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
	{ value: "inFrontmatter", label: "In frontmatter property" },
];
const linkTypeOptions = [
	{ value: "link", label: "Link" },
	{ value: "embed", label: "Embed" },
];
const displayTextOptions = [
	{ value: "none", label: "Default" },
	{ value: "selection", label: "Selected text" },
];
const frontmatterHandlingOptions = [
	{ value: "alwaysAppend", label: "Create or convert" },
	{ value: "createProperty", label: "Create if missing" },
	{ value: "error", label: "Require list" },
];

function nextOptions(overrides: Partial<AppendLinkOptions>): AppendLinkOptions {
	const current = appendLink;
	const currentOptions =
		typeof current === "boolean" ? normalized : current;
	const placement = overrides.placement ?? currentOptions.placement;
	const destination =
		overrides.destination ?? currentOptions.destination ?? normalized.destination;
	const linkType =
		destination.type === "activeFile" && placementSupportsEmbed(placement)
			? overrides.linkType ?? currentOptions.linkType ?? normalizedLinkType
			: "link";
	// Forced back to "none" when the conditions no longer hold — intentionally
	// as lossy as the linkType reset above (switching placement away and back
	// discards the stored preference).
	// Falls back to the NORMALIZED value (not the raw stored one) so a
	// malformed/unknown stored displayText is not written back on unrelated
	// dropdown changes — the UI persists what it displays.
	const displayText =
		destination.type === "activeFile" &&
		placementSupportsSelectionAlias(placement) &&
		linkType === "link"
			? overrides.displayText ?? normalizedDisplayText
			: "none";

	return {
		enabled: overrides.enabled ?? true,
		placement,
		requireActiveFile:
			overrides.requireActiveFile ??
			currentOptions.requireActiveFile ??
			normalized.requireActiveFile,
		linkType,
		displayText,
		destination,
		frontmatterProperty:
			overrides.frontmatterProperty ?? currentOptions.frontmatterProperty,
		frontmatterHandling:
			overrides.frontmatterHandling ?? currentOptions.frontmatterHandling,
	};
}

function onModeChange(value: string) {
	switch (value as AppendLinkMode) {
		case "disabled":
			appendLink = nextOptions({ enabled: false });
			break;
		case "required":
			appendLink = nextOptions({ requireActiveFile: true });
			break;
		case "optional":
			appendLink = nextOptions({ requireActiveFile: false });
			break;
	}
}

function onPlacementChange(value: string) {
	appendLink = nextOptions({
		placement: value as LinkPlacement,
	});
}

function onLinkTypeChange(value: string) {
	appendLink = nextOptions({
		linkType: value as LinkType,
	});
}

function onDisplayTextChange(value: string) {
	appendLink = nextOptions({
		displayText: value as LinkDisplayText,
	});
}

function onFrontmatterPropertyInput(event: Event) {
	appendLink = nextOptions({
		frontmatterProperty: (event.currentTarget as HTMLInputElement).value,
	});
}

function onFrontmatterHandlingChange(value: string) {
	appendLink = nextOptions({
		frontmatterHandling: value as FrontmatterHandling,
	});
}

function onDestinationChange(value: string) {
	const destination =
		(value as AppendLinkDestinationMode) === "specifiedFile"
			? { type: "specifiedFile" as const, path: destinationPath }
			: { type: "activeFile" as const };
	appendLink = nextOptions({ destination });
}

function onDestinationPathChange(value: string) {
	appendLink = nextOptions({
		destination: { type: "specifiedFile", path: value.trim() },
	});
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
				desc="Choose whether to insert a link or an embed. Embeds transclude the note's contents at the placement position."
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

		{#if placementSupportsSelectionAlias(normalized.placement) && normalizedLinkType === "link"}
			<SettingItem
				name="Link display text"
				desc="What the inserted link displays. 'Selected text' keeps the highlighted text as the link's display text; with nothing selected, the plain link is inserted."
			>
				{#snippet control()}
					<Dropdown
						value={normalizedDisplayText}
						options={displayTextOptions}
						onchange={onDisplayTextChange}
					/>
				{/snippet}
			</SettingItem>
		{/if}

		{#if placementSupportsFrontmatter(normalized.placement)}
			<SettingItem
				name="Frontmatter property"
				desc="Required property to insert the link into."
			>
				{#snippet control()}
					<input
						type="text"
						class="text-input"
						value={normalized.frontmatterProperty ?? ""}
						aria-label="Frontmatter property"
						aria-invalid={!(normalized.frontmatterProperty?.trim())}
						placeholder="related"
						required
						oninput={onFrontmatterPropertyInput}
					/>
				{/snippet}
			</SettingItem>

			<SettingItem
				name="Property handling"
				desc="Choose how strict QuickAdd should be when the property is missing or not a list."
			>
				{#snippet control()}
					<Dropdown
						value={normalizedFrontmatterHandling}
						options={frontmatterHandlingOptions}
						onchange={onFrontmatterHandlingChange}
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
