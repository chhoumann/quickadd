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
	class="flair qa-capability-flair"
	use:tooltip={description}
	class:qa-flair-critical={severity === "critical"}
	class:qa-flair-warning={severity === "warning"}>{label}</span
>

<style>
	.qa-capability-flair {
		margin-inline-start: 0;
		cursor: help;
	}
</style>
