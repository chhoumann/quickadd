<!-- Deliberately bad: `body` escapes the component's scope, so a stale copy
     would keep applying after an update. See tests/svelteCompilerOptions.test.ts. -->
<p class="note">Fixture</p>

<style>
	.note :global(strong) {
		font-weight: 600;
	}

	:global(body) {
		margin: 0;
	}
</style>
