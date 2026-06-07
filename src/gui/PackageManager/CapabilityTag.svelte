<script lang="ts">
	import type { PreviewFlag } from "../../services/packagePreview";
	import {
		flagSeverity,
		flagLabel,
		flagDescription,
	} from "../../services/packagePreview";
	import { tooltip } from "../shared/tooltip";

	let { flag }: { flag: PreviewFlag } = $props();

	const severity = $derived(flagSeverity(flag));
	const label = $derived(flagLabel(flag));
	const description = $derived(flagDescription(flag));
</script>

<span
	class="qa-import-tag"
	use:tooltip={description}
	class:critical={severity === "critical"}
	class:warning={severity === "warning"}
	class:info={severity === "info"}>{label}</span
>

<style>
	.qa-import-tag {
		display: inline-flex;
		align-items: center;
		padding: 0.05rem 0.4rem;
		border-radius: var(--radius-s, 4px);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		line-height: 1.45;
		white-space: nowrap;
		cursor: help;
	}

	/* Critical: darkened red so white text clears WCAG AA (~5:1) at this size,
	   where Obsidian's stock --color-red (#e93147) lands at ~3.5:1. */
	.qa-import-tag.critical {
		background: var(--qa-sev-critical-pill);
		color: #fff;
	}

	/* Warning: amber is medium-luminance in both themes, so near-black text
	   (~8:1) beats white-on-amber (~2.9:1). Fallback #ff8c00 matches styles.css
	   and clears AA (~5.9:1) with #1a1a1a. */
	.qa-import-tag.warning {
		background: var(--color-orange, #ff8c00);
		color: #1a1a1a;
	}

	.qa-import-tag.info {
		background: var(--background-modifier-border);
		color: var(--text-normal);
	}
</style>
