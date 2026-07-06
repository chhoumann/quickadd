<script lang="ts">
import type { App } from "obsidian";
import { Notice } from "obsidian";
import type QuickAdd from "../../../main";
import type ICaptureChoice from "../../../types/choices/ICaptureChoice";
import type { SectionOrdering } from "../../../types/choices/ICaptureChoice";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_ORDERED,
	CREATE_IF_NOT_FOUND_TOP,
} from "../../../constants";
import {
	FormatSyntaxSuggester,
	FormatSyntaxToken,
} from "../../suggesters/formatSyntaxSuggester";
import { detectDateFormatFromAfter } from "../../../utils/insertAfterDateFormat";
import { FormatDisplayFormatter } from "../../../formatters/formatDisplayFormatter";
import SettingItem from "../../components/SettingItem.svelte";
import Toggle from "../../components/Toggle.svelte";
import Dropdown from "../../components/Dropdown.svelte";
import ValidatedInput from "./ValidatedInput.svelte";
import FormatPreviewField from "./FormatPreviewField.svelte";

/** Reactive port of captureChoiceBuilder.addInsertAfterFields. */
let {
	insertAfter = $bindable(),
	app,
	plugin,
}: {
	insertAfter: ICaptureChoice["insertAfter"];
	app: App;
	plugin: QuickAdd;
} = $props();

// Defaults the imperative builder set when this section rendered (insertAfter
// enabled). Applied synchronously at init — before the template's bind:checked
// reads them — and kept section-local, so the persisted shape only changes for
// choices whose write position actually reaches "After line…" (parity with the
// imperative addInsertAfterFields).
if (insertAfter.inline === undefined) insertAfter.inline = false;
if (insertAfter.replaceExisting === undefined)
	insertAfter.replaceExisting = false;
if (insertAfter.promptHeading === undefined) insertAfter.promptHeading = false;
if (!insertAfter.blankLineAfterMatchMode)
	insertAfter.blankLineAfterMatchMode = "auto";
if (!insertAfter.createIfNotFound) insertAfter.createIfNotFound = false;
if (!insertAfter.createIfNotFoundLocation)
	insertAfter.createIfNotFoundLocation = CREATE_IF_NOT_FOUND_TOP;

const suggesters = [
	// Line-target field: withhold {{foldercurrent}}, which formatLocationString
	// deliberately leaves literal in selectors (a legitimate "" resolution would
	// match the first line), so it is never suggested where it cannot resolve.
	(el: HTMLInputElement | HTMLTextAreaElement) =>
		new FormatSyntaxSuggester(app, el, plugin, false, [
			FormatSyntaxToken.FolderCurrent,
		]),
];

const blankLineOptions = [
	{ value: "auto", label: "Auto (headings only)" },
	{ value: "skip", label: "Always skip" },
	{ value: "none", label: "Never skip" },
];

// Inline same-line insertion and ordered section placement are mutually
// exclusive (ordered always creates a heading on its own line). Omit "Ordered"
// while inline is on so it can never be selected into a crashing combination.
const createLocationOptions = $derived(
	insertAfter.inline
		? [
				{ value: CREATE_IF_NOT_FOUND_TOP, label: "Top" },
				{ value: CREATE_IF_NOT_FOUND_BOTTOM, label: "Bottom" },
				{ value: CREATE_IF_NOT_FOUND_CURSOR, label: "Cursor" },
			]
		: [
				{ value: CREATE_IF_NOT_FOUND_TOP, label: "Top" },
				{ value: CREATE_IF_NOT_FOUND_BOTTOM, label: "Bottom" },
				{ value: CREATE_IF_NOT_FOUND_CURSOR, label: "Cursor" },
				{
					value: CREATE_IF_NOT_FOUND_ORDERED,
					label: "Ordered (place new section among siblings)",
				},
			],
);

const orderByOptions = [
	{ value: "insertion", label: "Insertion order (no sorting)" },
	{ value: "lexical", label: "Text (A→Z)" },
	{ value: "numeric", label: "Number" },
	{ value: "date", label: "Date" },
	{ value: "semver", label: "Version (semver)" },
];
const orderDirectionOptions = [
	{ value: "desc", label: "Newest / highest first" },
	{ value: "asc", label: "Oldest / lowest first" },
];
const unparseableOptions = [
	{ value: "bottom", label: "Sort existing unparseable headings to bottom" },
	{ value: "top", label: "Sort existing unparseable headings to top" },
];

// Tracks whether the ordering descriptor is "pinned" — either the user explicitly
// chose a sort key / date format, or the choice arrived already carrying an
// orderBy (a saved/imported ordered choice). When pinned, the reactive seed never
// auto-rewrites `by`/`dateFormat` from the `after` text, so opening or editing an
// existing choice can't silently clobber its saved sort config.
let userPickedBy = $state(!!insertAfter.orderBy);

// Ordered placement is selected (regardless of whether "Create line if not found"
// is currently on). Used to gate the mutually-exclusive Inline toggle so the
// invalid inline+ordered combo can't be assembled via a toggle sequence.
const orderedSelected = $derived(
	insertAfter.createIfNotFoundLocation === CREATE_IF_NOT_FOUND_ORDERED,
);
// Ordered placement is ACTIVE (will run): location is ordered AND creation is on.
// Drives the ordered sub-panel + warnings.
const isOrdered = $derived(
	insertAfter.createIfNotFound && orderedSelected,
);

// Inline same-line insertion can only match a single line, but the live preview
// above expands `\n`, so a multi-line target looks valid while the capture
// silently never lands. Warn when inline mode is on and the target RESOLVES to
// more than one line (issue #468). We resolve with the same FormatDisplayFormatter
// the preview/runtime use — not a raw regex — so an escaped `\\n` (stays a literal
// backslash-n, single line) does not false-warn and a token/global-var that
// expands to a real newline is not missed.
const inlinePreviewFormatter = $derived(new FormatDisplayFormatter(app, plugin));
let inlineTargetHasLinebreak = $state(false);
$effect(() => {
	const raw = insertAfter.after ?? "";
	const formatter = inlinePreviewFormatter;
	if (!insertAfter.inline || raw === "") {
		inlineTargetHasLinebreak = false;
		return;
	}
	let cancelled = false;
	void formatter
		.format(raw)
		.then((resolved) => {
			if (!cancelled) inlineTargetHasLinebreak = /[\n\r]/.test(resolved);
		})
		.catch(() => {
			if (!cancelled) inlineTargetHasLinebreak = false;
		});
	return () => {
		cancelled = true;
	};
});

// Non-optional read view for the ordered sub-panel: the panel only renders when
// `insertAfter.orderBy` is present, but its `{#snippet}` closures lose the
// truthiness narrowing, so reads go through this guaranteed-present derived.
// Writes still target `insertAfter.orderBy` through guarded handlers.
const ordering = $derived<SectionOrdering>(
	insertAfter.orderBy ?? { by: "insertion", direction: "desc", unparseable: "bottom" },
);


const afterHasDateToken = $derived(/\{\{V?DATE\b/i.test(insertAfter.after ?? ""));
const showInsertionFallbackWarning = $derived(
	isOrdered &&
		insertAfter.orderBy?.by === "insertion" &&
		afterHasDateToken &&
		!detectDateFormatFromAfter(insertAfter.after ?? ""),
);

// Single seeder (builder-owned): seed orderBy when "ordered" is first selected,
// and while the user hasn't pinned a key, keep the date/insertion choice in sync
// with the `after` text. Resolves the Load-vs-builder two-seeder divergence.
$effect(() => {
	// Only seed when ordered placement is actually active (location ordered AND
	// creation on), so a merely-selected-but-inert ordered location never persists
	// dead orderBy config.
	if (!isOrdered) return;
	const fmt = detectDateFormatFromAfter(insertAfter.after ?? "");
	if (!insertAfter.orderBy) {
		insertAfter.orderBy = {
			by: fmt ? "date" : "insertion",
			direction: "desc",
			dateFormat: fmt,
			unparseable: "bottom",
		};
		return;
	}
	if (
		!userPickedBy &&
		(insertAfter.orderBy.by === "insertion" || insertAfter.orderBy.by === "date")
	) {
		insertAfter.orderBy.by = fmt ? "date" : "insertion";
		insertAfter.orderBy.dateFormat = fmt;
	}
});

function onCreateLocationChange(value: string) {
	insertAfter.createIfNotFoundLocation = value;
	if (value === CREATE_IF_NOT_FOUND_ORDERED) {
		// Ordered always creates a heading on its own line.
		insertAfter.inline = false;
	} else {
		// Leaving ordered: drop the now-irrelevant descriptor so stale config
		// never persists on a non-ordered choice.
		insertAfter.orderBy = undefined;
		userPickedBy = false;
	}
}

function onOrderByChange(value: string) {
	userPickedBy = true;
	if (!insertAfter.orderBy) return;
	insertAfter.orderBy.by = value as SectionOrdering["by"];
}

function onConsiderSubsectionsToggle(value: boolean) {
	// In heading mode the runtime target is always a heading, so the
	// "starts with #" guard would misfire against the empty/hidden `after` text.
	if (insertAfter.promptHeading) return;
	if (value && !insertAfter.after.startsWith("#")) {
		// Two-way bind syncs the toggle back to off when the target isn't a heading.
		insertAfter.considerSubsections = false;
		new Notice(
			"Consider subsections requires the target to be a heading (starts with #)",
		);
	}
}

function onPromptHeadingToggle(value: boolean) {
	// Heading mode always inserts on its own line under the picked heading (the block
	// path), so clear the inline same-line flags when it's switched on.
	if (value) {
		insertAfter.inline = false;
		insertAfter.replaceExisting = false;
	}
}
</script>

<SettingItem
	name="Choose heading when capturing"
	desc="Instead of typing a target line now, show a dropdown of the target note's headings when you run this capture and insert under the one you pick."
>
	{#snippet control()}
		<Toggle
			bind:checked={insertAfter.promptHeading}
			onchange={onPromptHeadingToggle}
		/>
	{/snippet}
</SettingItem>

{#if insertAfter.promptHeading}
	<div class="setting-item-description">
		You'll pick a heading from the target note when you run this capture, and the
		text is inserted under it. Use the toggles below to control placement within that
		section.
	</div>
{:else}
	<SettingItem
		name="Insert after"
		desc="Insert capture after specified text. Accepts format syntax. Tip: use a heading (starts with #) to target a section. Blank line handling is configurable below."
	/>
	<FormatPreviewField value={insertAfter.after} formatterKind="lineTarget" {app} {plugin} />
	<ValidatedInput
		bind:value={insertAfter.after}
		placeholder="Insert after"
		required
		requiredMessage="Insert after text is required"
		makeSuggesters={suggesters}
		ariaLabel="Insert after"
	/>

	<SettingItem
		name="Inline insertion"
		desc={orderedSelected
			? "Inline insertion can't be combined with ordered placement."
			: "Insert captured content on the same line, immediately after the matched text (no newline added)."}
	>
		{#snippet control()}
			<Toggle bind:checked={insertAfter.inline} disabled={orderedSelected} />
		{/snippet}
	</SettingItem>

	{#if inlineTargetHasLinebreak}
		<div class="setting-item-description">
			Inline insertion needs a single-line target. The line break (\n) can't be
			matched on the same line — remove it, or turn off "Inline insertion".
		</div>
	{/if}
{/if}

{#if insertAfter.inline}
	<SettingItem
		name="Replace existing value"
		desc="Replace everything after the matched text up to end-of-line."
	>
		{#snippet control()}
			<Toggle bind:checked={insertAfter.replaceExisting} />
		{/snippet}
	</SettingItem>
{:else}
	<SettingItem
		name="Insert at end of section"
		desc="Place the text at the end of the matched section instead of the top."
	>
		{#snippet control()}
			<Toggle bind:checked={insertAfter.insertAtEnd} />
		{/snippet}
	</SettingItem>

	<SettingItem
		name="Blank lines after match"
		desc={insertAfter.insertAtEnd
			? "Not used when inserting at end of section."
			: "Controls whether Insert After skips existing blank lines after the matched line."}
	>
		{#snippet control()}
			<Dropdown
				value={insertAfter.blankLineAfterMatchMode ?? "auto"}
				options={blankLineOptions}
				disabled={insertAfter.insertAtEnd}
				onchange={(value) =>
					(insertAfter.blankLineAfterMatchMode = value as
						| "auto"
						| "skip"
						| "none")}
			/>
		{/snippet}
	</SettingItem>

	<SettingItem
		name="Consider subsections"
		desc={!insertAfter.insertAtEnd
			? "Only affects placement when “Insert at end of section” is on."
			: insertAfter.promptHeading
				? "Also include the chosen heading’s subsections (nested headings inside its section)."
				: "Also include the section’s subsections (requires target to be a heading starting with #). Subsections are headings inside the section."}
	>
		{#snippet control()}
			<Toggle
				bind:checked={insertAfter.considerSubsections}
				disabled={!insertAfter.insertAtEnd}
				onchange={onConsiderSubsectionsToggle}
			/>
		{/snippet}
	</SettingItem>
{/if}

<SettingItem
	name="Create line if not found"
	desc="Creates the 'insert after' line if it is not found."
>
	{#snippet control()}
		<Toggle bind:checked={insertAfter.createIfNotFound} />
		<Dropdown
			value={insertAfter.createIfNotFoundLocation || CREATE_IF_NOT_FOUND_TOP}
			options={createLocationOptions}
			onchange={onCreateLocationChange}
		/>
	{/snippet}
</SettingItem>

{#if isOrdered && insertAfter.orderBy}
	<div class="setting-item-description">
		The "Insert after" heading is created at its sorted position among ALL
		same-level headings in the note (it is not scoped to one parent section). It
		does NOT re-sort headings you already have; only the new one is placed. Use
		"Insert at end of section" above for newest-on-top vs. appended entries within
		each section.
	</div>

	<SettingItem name="Sort sections by">
		{#snippet control()}
			<Dropdown
				value={ordering.by}
				options={orderByOptions}
				onchange={onOrderByChange}
			/>
		{/snippet}
	</SettingItem>

	<SettingItem name="Section order">
		{#snippet control()}
			<Dropdown
				value={ordering.direction}
				options={orderDirectionOptions}
				onchange={(value) => {
					if (insertAfter.orderBy)
						insertAfter.orderBy.direction =
							value as SectionOrdering["direction"];
				}}
			/>
		{/snippet}
	</SettingItem>

	{#if ordering.by === "date"}
		<SettingItem
			name="Date format"
			desc="Moment format used to parse existing heading dates for sorting (e.g. YYYY-MM-DD)."
		>
			{#snippet control()}
				<ValidatedInput
					value={ordering.dateFormat ?? ""}
					placeholder="YYYY-MM-DD"
					ariaLabel="Date format"
					onChange={(value) => {
						// A deliberate format edit pins the descriptor so the after-keyed
						// seeder stops re-deriving dateFormat from the token.
						userPickedBy = true;
						if (insertAfter.orderBy) insertAfter.orderBy.dateFormat = value;
					}}
				/>
			{/snippet}
		</SettingItem>
	{/if}

	{#if ordering.by === "date" || ordering.by === "numeric" || ordering.by === "semver"}
		<SettingItem
			name="Existing unparseable headings"
			desc="Where to rank EXISTING headings whose text can't be parsed for this sort. (A new heading that can't be parsed is appended at the end.)"
		>
			{#snippet control()}
				<Dropdown
					value={ordering.unparseable ?? "bottom"}
					options={unparseableOptions}
					onchange={(value) => {
						if (insertAfter.orderBy)
							insertAfter.orderBy.unparseable =
								value as NonNullable<SectionOrdering["unparseable"]>;
					}}
				/>
			{/snippet}
		</SettingItem>
	{/if}

	{#if ordering.by === "insertion"}
		<div class="setting-item-description">
			No sorting: newest-first prepends the new section above existing ones;
			oldest-first appends it below.
		</div>
	{/if}

	{#if showInsertionFallbackWarning}
		<div class="setting-item-description">
			This heading uses a date token QuickAdd can't auto-read for sorting. Pick
			"Date" and enter the format, or sections stay in insertion order.
		</div>
	{/if}
{/if}
