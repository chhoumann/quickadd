<script lang="ts">
import type { App } from "obsidian";
import type { FormatterPluginContext } from "../../../types/pluginContext";
import { FormatDisplayFormatter } from "../../../formatters/formatDisplayFormatter";
import { FileNameDisplayFormatter } from "../../../formatters/fileNameDisplayFormatter";
import type { PreviewDiagnostic } from "../../../formatters/previewDiagnostics";

/**
 * Live "Preview: …" row for a format field, rendered below its input and not at
 * all while the field is empty. Un-debounced; a monotonic token drops stale
 * async results.
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
	plugin: FormatterPluginContext;
	/**
	 * The choice's target folder for {{FOLDER}}; `undefined` previews a
	 * "Folder/Name" placeholder. `null` means the host has no folder concept, and
	 * {{FOLDER}} previews as the runtime's empty string.
	 */
	targetFolderPath?: string | null;
	/**
	 * Asked of the resolved preview text; true hides the row. For the capture
	 * target, which may resolve to picker syntax (`property:type=draft`) rather
	 * than a path.
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

// Gated on the resolved text. Never hidden over a non-path error: a pass can
// fail and still leave picker-looking text, and hiding would drop the message
// that explains the failure.
const hidden = $derived(
	hideWhen
		? hideWhen(preview) &&
			!diagnostics.some((d) => d.severity === "error" && d.kind !== "path")
		: false,
);

// "Unresolved" when the format could not be resolved (the row shows the raw text
// back); "Preview" otherwise, including for `kind: "path"` problems, where the
// format resolved but the vault will not accept the result. Unresolved wins when
// both apply. `diagnostics` survives a value change until the next pass commits,
// so the row always shows one pass's text under that pass's label: stale, never
// mixed.
const errors = $derived(showDiagnostics ? diagnostics.filter((d) => d.severity === "error") : []);
const isUnresolved = $derived(errors.some((d) => d.kind !== "path"));
const isInvalid = $derived(!isUnresolved && errors.length > 0);

$effect(() => {
	const current = value;
	// Clearing the field also clears the cached preview and cancels any in-flight
	// resolve, so re-typing never flashes the previous result.
	if (!current.trim()) {
		previewToken++;
		preview = "";
		diagnostics = [];
		return;
	}
	// A fresh formatter per pass: it carries per-pass diagnostics and a variables
	// cache that would otherwise preview stale values.
	const formatter =
		formatterKind === "fileName"
			? new FileNameDisplayFormatter(app, plugin)
			: new FormatDisplayFormatter(app, plugin, undefined, {
					resolveActiveFolder: formatterKind !== "lineTarget",
				});
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

// Problems wait until the field is still: each quotes the partial token it is
// about, so shown live they would rewrite on every keystroke.
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
	<!-- Clamped: this row can hold a whole included template. The full text is in `title`. -->
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
					<!-- Severity in text, not colour alone (WCAG 1.4.1). -->
					<span class="qa-visually-hidden"
						>{diagnostic.severity === "error" ? "Error: " : "Warning: "}</span
					>{diagnostic.message}
				</div>
			{/each}
		</div>
	{/if}
{/if}
