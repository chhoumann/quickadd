<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import { FormatDisplayFormatter } from "../../../formatters/formatDisplayFormatter";
import { FileNameDisplayFormatter } from "../../../formatters/fileNameDisplayFormatter";
import type { PreviewDiagnostic } from "../../../formatters/previewDiagnostics";

/**
 * Live "Preview: …" row for a format/filename field, plus any problems that pass
 * ran into. Renders BELOW the input it previews (issue #1543 — it used to sit
 * above, where it read as the field's label), and not at all while the field is
 * empty, so there is never a dangling "Preview:" with nothing after it.
 *
 * The preview TEXT is un-debounced, preserving the imperative builders'
 * per-keystroke behavior (Plan 010 debounce is deliberately out of scope for
 * #1130). A monotonic token drops stale async results so the latest value
 * always wins.
 */
let {
	value,
	formatterKind = "format",
	app,
	plugin,
	targetFolderPath,
	hideWhen,
}: {
	value: string;
	/**
	 * "lineTarget" is the insert-after/before selector preview: identical to
	 * "format" except {{foldercurrent}} stays literal, matching the runtime
	 * formatLocationString (which deliberately never resolves it in selectors).
	 */
	formatterKind?: "format" | "fileName" | "lineTarget";
	app: App;
	plugin: QuickAdd;
	/**
	 * The choice's configured target folder, so {{FOLDER}} / {{FOLDER|name}}
	 * preview meaningfully. When `undefined` we fall back to a "Folder/Name"
	 * placeholder rather than an empty string (no caller wires the real path in
	 * yet, but the placeholder keeps the FOLDER token from previewing blank).
	 *
	 * `null` means the host has no target folder CONCEPT at all — not "unknown"
	 * — and {{FOLDER}} previews as the empty string the runtime produces
	 * (`Formatter.replaceMacrosInString`: `this.targetFolderPath ?? ""`). The
	 * user-script format option is such a host: nothing there ever creates a note
	 * in a folder, so the placeholder would invent a path the script cannot get.
	 */
	targetFolderPath?: string | null;
	/**
	 * Asked of the RESOLVED preview text: does this field's host consider the
	 * result something other than the thing this row previews? When it answers
	 * yes the row does not render at all.
	 *
	 * Exists for the capture target, whose value can be a path OR picker syntax
	 * (`property:type=draft`), and which the run resolves BEFORE deciding which.
	 * The host can gate on the raw field itself, but not on what a token expands
	 * to - and previewing picker syntax as a path invents a fake path and, since
	 * #1578, an illegal-character error for a capture that runs fine.
	 */
	hideWhen?: (resolvedPreview: string) => boolean;
} = $props();

/** How long the field must sit still before its problems are shown. */
const DIAGNOSTICS_IDLE_MS = 500;

let preview = $state("");
let diagnostics = $state<readonly PreviewDiagnostic[]>([]);
let showDiagnostics = $state(false);
let previewToken = 0;

// Gate the row on the RAW value, never on the resolved preview: the formatter is
// async, so the row must mount (empty) and then be filled for `aria-live` to
// announce the result. Gating on the resolved text would mount it already
// populated, and the announcement would be lost.
const hasValue = $derived(value.trim().length > 0);

// Gated on the RESOLVED text, so it can only be answered once the async pass
// has produced one. Until then `preview` is "" and the row mounts empty, which
// is what `aria-live` needs anyway.
//
// Never over an error about something OTHER than the path: a pass can fail and
// still leave text that looks like picker syntax -
// `{{GLOBAL_VAR:inbox}}{{TEMPLATE:missing.md}}` resolves to `property:type=draft`
// followed by a not-found placeholder, and the run aborts on the missing
// template. Hiding the row there would take the one message that explains it.
// The `kind: "path"` problems are the ones this host is entitled to discard:
// they say the result is not a usable path, which is exactly what it is not
// trying to be.
const hidden = $derived(
	hideWhen
		? hideWhen(preview) &&
			!diagnostics.some((d) => d.severity === "error" && d.kind !== "path")
		: false,
);

// Two different things can be wrong, and one label for both sent readers
// hunting for a broken token when every token had resolved (issue #1594).
//
// A field whose format could not be RESOLVED is not showing a preview of the
// output — it is showing the raw text back. Say so, rather than letting
// "Preview:" assert that this IS what you will get.
//
// The `kind: "path"` problems are the other class: the format resolved
// perfectly, the vault just will not accept the result (a "."/".." or empty
// segment, #1563; a character Obsidian refuses, #1578). That is the ordinary
// case on a file-name field, and the row IS an accurate preview — of a name
// that will never exist. Reusing the axis #1582 already added for `hideWhen`
// keeps one classification instead of two that can disagree.
//
// Unresolved wins when both are present: if a template is missing AND the
// result has an empty segment, the fundamental failure is that it did not
// resolve.
//
// `diagnostics` deliberately SURVIVES a value change until the next pass
// commits. A pass can outlast the 500ms gate (it may read up to 25 templates),
// so the gate can open while the previous result is still shown - but `preview`
// and `diagnostics` are written together under `previewToken`, so what is on
// screen is always one pass's text under that same pass's label and complaint.
// Stale, never mixed.
//
// Clearing `diagnostics` here instead would leave the previous, known-bad name
// on screen under a plain "Preview:" label for the length of the pass, which is
// precisely the assertion this row exists to withdraw. Pinned by "a slow pass
// never mixes two values in one row" in the sibling test.
const errors = $derived(showDiagnostics ? diagnostics.filter((d) => d.severity === "error") : []);
const isUnresolved = $derived(errors.some((d) => d.kind !== "path"));
const isInvalid = $derived(!isUnresolved && errors.length > 0);

$effect(() => {
	const current = value;
	// Clearing the field also clears the cached preview (and cancels any in-flight
	// resolve), so re-typing never flashes the previous value's result in the
	// freshly re-mounted row.
	if (!current.trim()) {
		previewToken++;
		preview = "";
		diagnostics = [];
		return;
	}
	// A formatter per pass, not one memoized for the field's lifetime. It carries
	// per-pass state — this pass's diagnostics, and a `variables` map whose
	// resolved keys short-circuit the next resolve — so reusing one instance made
	// an edited option list preview the stale value and let a warn-once guard
	// fire from a keystroke. Construction is trivial.
	const formatter =
		formatterKind === "fileName"
			? new FileNameDisplayFormatter(app, plugin)
			: new FormatDisplayFormatter(app, plugin, undefined, {
					resolveActiveFolder: formatterKind !== "lineTarget",
				});
	// Resolve {{FOLDER}} / {{FOLDER|name}} against the configured target folder,
	// or a "Folder/Name" placeholder so the token never previews blank when no
	// caller wires the real path in (issue: FOLDER preview always empty). An
	// explicit null says this host has no folder at all, and previews "".
	formatter.setTargetFolderPath(
		targetFolderPath === null
			? null
			: targetFolderPath?.trim()
				? targetFolderPath
				: "Folder/Name",
	);
	const token = ++previewToken;
	void (async () => {
		try {
			const formatted = await formatter.format(current);
			// Text and problems commit under the same guard, so the row can never
			// show one pass's preview beside another pass's complaint.
			if (token !== previewToken) return;
			preview = formatted;
			diagnostics = formatter.diagnostics.list();
		} catch {
			// format() catches its own failures and reports them as diagnostics, so
			// reaching here means something outside the pipeline broke. Say so in
			// the same place rather than leaving a stale preview standing.
			if (token !== previewToken) return;
			preview = current;
			diagnostics = [
				{ severity: "error", message: "Preview unavailable." },
			];
		}
	})();
});

// Problems are held back until the field has been still for a moment. Every one
// of these messages quotes the partial token it is about, so shown live they
// would rewrite themselves on every keystroke while you type an argument — the
// quieter cousin of the Notice storm this replaced (issue #1558). Lint-on-idle
// is the editor convention. The preview text itself stays live.
$effect(() => {
	void value;
	showDiagnostics = false;
	const timer = setTimeout(() => {
		showDiagnostics = true;
	}, DIAGNOSTICS_IDLE_MS);
	return () => clearTimeout(timer);
});
</script>

{#if hasValue && !hidden}
	<!-- A file name is one line, and since #1563 this row can hold a whole
	     included template - which would wrap to fifteen lines of muted text under
	     a single-line input and push the rest of the builder down on every
	     keystroke. Clamped like .qa-preview-issue, with the full text in `title`. -->
	<div
		class="qa-preview-row"
		class:qa-preview-row--one-line={formatterKind === "fileName"}
		title={formatterKind === "fileName" ? preview : undefined}
	>
		<span class="qa-preview-label"
			>{isUnresolved
				? "Unresolved: "
				: isInvalid
					? "Won't be created: "
					: "Preview: "}</span
		><span class="qa-preview-value" aria-live="polite">{preview}</span>
	</div>
	{#if showDiagnostics && diagnostics.length > 0}
		<!-- No aria-live: .qa-preview-value above already owns one for this field,
		     and a second competing region reads back over the first. -->
		<div class="qa-preview-issues">
			{#each diagnostics as diagnostic (diagnostic.severity + diagnostic.message)}
				<div
					class="qa-preview-issue"
					class:qa-preview-issue--error={diagnostic.severity === "error"}
					title={diagnostic.message}
				>
					<!-- Severity in TEXT, not colour alone (WCAG 1.4.1). Visually hidden
					     rather than a printed "Warning:"/"Error:" prefix: the messages
					     already clamp at three lines, and what a sighted user needs -
					     "did this resolve at all" - is carried by the Preview/Unresolved
					     label above. -->
					<span class="qa-visually-hidden"
						>{diagnostic.severity === "error" ? "Error: " : "Warning: "}</span
					>{diagnostic.message}
				</div>
			{/each}
		</div>
	{/if}
{/if}
