<script lang="ts">
	import { untrack } from "svelte";

	// Test fixture for mountComponent's failure path: reproduces the shape that
	// actually shipped (#1584) - a malformed value from data.json dereferenced
	// during setup, which throws out of mount(). untrack because the read is
	// deliberately one-shot at setup time (and silences state_referenced_locally).
	let { commands }: { commands?: unknown } = $props();

	const count = untrack(() => (commands as unknown[]).filter(Boolean).length);
</script>

<div class="mount-throws-fixture">{count}</div>
