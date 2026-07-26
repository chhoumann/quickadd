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
	 * preview meaningfully. When unknown we fall back to a "Folder/Name"
	 * placeholder rather than an empty string (no caller wires the real path in
	 * yet, but the placeholder keeps the FOLDER token from previewing blank).
	 */
	targetFolderPath?: string;
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

// A field whose format could not be resolved is not showing a preview of the
// output — it is showing the raw text back. Say so, rather than letting
// "Preview:" assert that this IS what you will get.
const isUnresolved = $derived(
	showDiagnostics && diagnostics.some((d) => d.severity === "error"),
);

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
	// caller wires the real path in (issue: FOLDER preview always empty).
	formatter.setTargetFolderPath(
		targetFolderPath?.trim() ? targetFolderPath : "Folder/Name",
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

{#if hasValue}
	<div class="qa-preview-row">
		<span class="qa-preview-label">{isUnresolved ? "Unresolved: " : "Preview: "}</span
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
					{diagnostic.message}
				</div>
			{/each}
		</div>
	{/if}
{/if}
