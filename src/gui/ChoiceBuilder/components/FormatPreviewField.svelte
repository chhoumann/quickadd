<script lang="ts">
import type { App } from "obsidian";
import type QuickAdd from "../../../main";
import { FormatDisplayFormatter } from "../../../formatters/formatDisplayFormatter";
import { FileNameDisplayFormatter } from "../../../formatters/fileNameDisplayFormatter";

/**
 * Live "Preview: …" row for a format/filename field. Un-debounced to preserve
 * the imperative builders' per-keystroke behavior (Plan 010 debounce is
 * deliberately out of scope for #1130). A monotonic token drops stale async
 * results so the latest value always wins.
 */
let {
	value,
	formatterKind = "format",
	app,
	plugin,
}: {
	value: string;
	formatterKind?: "format" | "fileName";
	app: App;
	plugin: QuickAdd;
} = $props();

let preview = $state("Loading preview…");
let previewToken = 0;

// app/plugin/kind are stable for the field's lifetime, so this $derived computes
// the formatter once; the reactive effect below then only re-runs on `value`
// change. ($derived is a reactive context, so referencing the props here is
// correct — a plain top-level const would capture only their initial value.)
const formatter = $derived(
	formatterKind === "fileName"
		? new FileNameDisplayFormatter(app, plugin)
		: new FormatDisplayFormatter(app, plugin),
);

$effect(() => {
	const current = value;
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

<div class="qa-preview-row">
	<span class="qa-preview-label">Preview: </span>
	<span aria-live="polite">{preview}</span>
</div>
