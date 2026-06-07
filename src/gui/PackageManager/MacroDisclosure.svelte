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
		InfiniteAIAssistant: "AI assistant",
		OpenFile: "Open file",
	};

	function humanCommandType(type: string): string {
		return HUMAN_COMMAND_TYPE[type] ?? type;
	}
</script>

<ul class="macroCommands">
	{#each commands as command, index (index)}
		<li style={`padding-left:${command.depth * 1}rem`}>
			<span class="macroCommandName">{command.name}</span>
			{#if command.flag}
				<CapabilityTag flag={command.flag} />
			{:else}
				<span class="macroCommandType"
					>{humanCommandType(command.type)}</span
				>
			{/if}
			{#if command.scriptPath}
				<code>{command.scriptPath}</code>
			{:else if command.summary}
				<span class="macroCommandSummary">{command.summary}</span>
			{/if}
		</li>
	{/each}
</ul>

<style>
	.macroCommands {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.macroCommands li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		font-size: var(--font-ui-smaller, 0.85rem);
	}

	.macroCommandName {
		font-weight: 500;
	}

	.macroCommandType {
		color: var(--text-muted);
		font-size: 0.72rem;
	}

	.macroCommandSummary {
		color: var(--text-muted);
	}
</style>
