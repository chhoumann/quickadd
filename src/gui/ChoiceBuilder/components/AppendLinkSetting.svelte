<script lang="ts">
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import Toggle from "../../components/Toggle.svelte";
import type {
	AppendLinkOptions,
	LinkPlacement,
	LinkType,
} from "../../../types/linkPlacement";
import {
	normalizeAppendLinkOptions,
	placementSupportsEmbed,
} from "../../../types/linkPlacement";

/**
 * Shared append-link configuration — collapses the near-identical
 * addAppendLinkSetting from captureChoiceBuilder and templateChoiceBuilder.
 * Conditional placement / link-type rows are reactive `{#if}` blocks; the old
 * `reload()` calls are gone (whole-value reassignment drives re-render).
 */
let {
	appendLink = $bindable(),
	fileLabel,
}: {
	appendLink: boolean | AppendLinkOptions;
	fileLabel: "captured" | "created";
} = $props();

type AppendLinkMode = "required" | "optional" | "disabled";

const normalized = $derived(normalizeAppendLinkOptions(appendLink));
const normalizedLinkType = $derived(normalized.linkType ?? "link");
const copyToClipboard = $derived(normalized.copyToClipboard ?? false);
const currentMode = $derived(
	normalized.enabled
		? normalized.requireActiveFile
			? "required"
			: "optional"
		: "disabled",
);

const modeOptions = [
	{ value: "required", label: "Enabled (requires active file)" },
	{ value: "optional", label: "Enabled (skip if no active file)" },
	{ value: "disabled", label: "Disabled" },
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
			appendLink = copyToClipboard
				? {
					enabled: false,
					copyToClipboard: true,
					placement: normalized.placement,
					requireActiveFile: false,
					linkType: normalizedLinkType,
				}
				: false;
			break;
		case "required":
			appendLink = {
				enabled: true,
				copyToClipboard,
				placement: normalized.placement,
				requireActiveFile: true,
				linkType: normalizedLinkType,
			};
			break;
		case "optional":
			appendLink = {
				enabled: true,
				copyToClipboard,
				placement: normalized.placement,
				requireActiveFile: false,
				linkType: normalizedLinkType,
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
		copyToClipboard,
		placement,
		requireActiveFile,
		linkType: nextLinkType,
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
		copyToClipboard,
		placement,
		requireActiveFile,
		linkType: value as LinkType,
	};
}

function onCopyToClipboardChange(value: boolean) {
	const current = appendLink;
	const enabled = typeof current === "boolean" ? normalized.enabled : current.enabled;
	const requireActiveFile =
		typeof current === "boolean"
			? normalized.requireActiveFile
			: current.requireActiveFile;
	const placement =
		typeof current === "boolean" ? normalized.placement : current.placement;
	const linkType =
		typeof current === "boolean" ? normalizedLinkType : current.linkType ?? normalizedLinkType;

	if (!value && !enabled) {
		appendLink = false;
		return;
	}

	appendLink = {
		enabled,
		copyToClipboard: value,
		placement,
		requireActiveFile,
		linkType,
	};
}
</script>

<SettingItem
	name={`Link to ${fileLabel} file`}
	desc={`Choose how QuickAdd should insert a link to the ${fileLabel} file in the current note.`}
>
	{#snippet control()}
		<Dropdown value={currentMode} options={modeOptions} onchange={onModeChange} />
	{/snippet}
</SettingItem>

<SettingItem
	name="Copy link to clipboard"
	desc={`Copy the ${fileLabel} file's Obsidian link after QuickAdd finishes.`}
>
	{#snippet control()}
		<Toggle
			checked={copyToClipboard}
			ariaLabel="Copy link to clipboard"
			onchange={onCopyToClipboardChange}
		/>
	{/snippet}
</SettingItem>

{#if currentMode !== "disabled"}
	<SettingItem name="Link placement" desc="Where to place the link when appending">
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
{/if}
