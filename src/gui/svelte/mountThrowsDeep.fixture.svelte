<script lang="ts">
	import MountThrows from "./mountThrows.fixture.svelte";

	// The throw happens BELOW some markup, so mount() gets part-way through before
	// it fails - the case that leaves stray nodes in the host.
	let { commands }: { commands?: unknown } = $props();
</script>

<div class="mount-throws-deep-fixture">
	<p>header</p>
	<MountThrows {commands} />
</div>
