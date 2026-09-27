<script lang="ts">
	import CapabilityTag from "./CapabilityTag.svelte";
	import type { PreviewCommand } from "../../services/packagePreview";

	let { commands }: { commands: PreviewCommand[] } = $props();

	const HUMAN_COMMAND_TYPE: Record<string, string> = {
		UserScript: "User script",
		Conditional: "Conditional",
		NestedChoice: "Nested choice",
		Obsidian: "Obsidian command",
		Choice: "Choice",
		Wait: "Wait",
		EditorCommand: "Editor command",
		AIAssistant: "AI assistant",
		OpenFile: "Open file",
	};

	function humanCommandType(type: string): string {
		return HUMAN_COMMAND_TYPE[type] ?? type;
	}
</script>

<ul class="qa-macro-commands">
	{#each commands as command, index (index)}
		<li style={`--qa-macro-depth: ${command.depth}`}>
			<span class="qa-macro-command-name">{command.name}</span>
			{#if command.flag}
				<CapabilityTag flag={command.flag} />
			{:else}
				<span class="qa-macro-command-type"
					>{humanCommandType(command.type)}</span
				>
			{/if}
			{#if command.scriptPath}
				<code>{command.scriptPath}</code>
			{:else if command.summary}
				<span class="qa-macro-command-summary">{command.summary}</span>
			{/if}
		</li>
	{/each}
</ul>

<style>
	/* Obsidian's outline/file-tree indentation guide on the left. */
	.qa-macro-commands {
		list-style: none;
		margin: 0;
		padding: 0 0 0 var(--size-4-3);
		border-inline-start: var(--nav-indentation-guide-width, 1px) solid
			var(--nav-indentation-guide-color, var(--background-modifier-border));
		display: flex;
		flex-direction: column;
		gap: var(--size-4-1);
	}

	.qa-macro-commands li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--size-4-1) var(--size-4-2);
		padding-inline-start: calc(var(--qa-macro-depth, 0) * var(--size-4-4));
		font-size: var(--font-ui-smaller);
		line-height: var(--line-height-tight);
	}

	.qa-macro-command-type,
	.qa-macro-command-summary {
		color: var(--text-muted);
	}

	.qa-macro-commands code {
		font-family: var(--font-monospace);
		font-size: var(--code-size);
		color: var(--text-muted);
		overflow-wrap: anywhere;
	}
</style>
