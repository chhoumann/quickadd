<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import { FormatDisplayFormatter } from "../../../formatters/formatDisplayFormatter";
import { FileNameDisplayFormatter } from "../../../formatters/fileNameDisplayFormatter";

/**
 * Live "Preview: …" row for a format/filename field. Renders BELOW the input it
 * previews (issue #1543 — it used to sit above, where it read as the field's
 * label), and not at all while the field is empty, so there is never a dangling
 * "Preview:" with nothing after it.
 *
 * Un-debounced to preserve the imperative builders' per-keystroke behavior (Plan
 * 010 debounce is deliberately out of scope for #1130). A monotonic token drops
 * stale async results so the latest value always wins.
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

let preview = $state("");
let previewToken = 0;

// Gate the row on the RAW value, never on the resolved preview: the formatter is
// async, so the row must mount (empty) and then be filled for `aria-live` to
// announce the result. Gating on the resolved text would mount it already
// populated, and the announcement would be lost.
const hasValue = $derived(value.trim().length > 0);

// app/plugin/kind are stable for the field's lifetime, so this $derived computes
// the formatter once; the reactive effect below then only re-runs on `value`
// change. ($derived is a reactive context, so referencing the props here is
// correct — a plain top-level const would capture only their initial value.)
const formatter = $derived(
	formatterKind === "fileName"
		? new FileNameDisplayFormatter(app, plugin)
		: new FormatDisplayFormatter(app, plugin, undefined, {
				resolveActiveFolder: formatterKind !== "lineTarget",
			}),
);

$effect(() => {
	const current = value;
	// Clearing the field also clears the cached preview (and cancels any in-flight
	// resolve), so re-typing never flashes the previous value's result in the
	// freshly re-mounted row.
	if (!current.trim()) {
		previewToken++;
		preview = "";
		return;
	}
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
			if (token === previewToken) preview = formatted;
		} catch {
			if (token === previewToken) preview = "Preview unavailable";
		}
	})();
});
</script>

{#if hasValue}
	<div class="qa-preview-row">
		<span class="qa-preview-label">Preview: </span>
		<span class="qa-preview-value" aria-live="polite">{preview}</span>
	</div>
{/if}
