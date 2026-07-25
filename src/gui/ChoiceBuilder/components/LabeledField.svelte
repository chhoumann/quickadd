<script lang="ts">
import type { Snippet } from "svelte";
import SettingItem from "../../components/SettingItem.svelte";

/**
 * A full-width field with a real label: an Obsidian `.setting-item` row carrying
 * the name, description and (optionally) the toggle that enables the field, with
 * the field itself on its own line beneath — `<label for>`-bound to the name.
 *
 * The builders used to hand-assemble this shape from three unrelated siblings: a
 * control-less SettingItem for the label, a preview row, and a bare full-width
 * input. Nothing tied the parts together, so every assembly drifted on its own —
 * which is how one field ended up described three ways (#1544), how the preview
 * ended up above the input it previews (#1543), and how the create-with-template
 * path input ended up with no visible label at all.
 */
let {
	name,
	desc = undefined,
	control = undefined,
	bodyVisible = true,
	children,
}: {
	name: string;
	desc?: string | undefined;
	/** Control on the label row, e.g. the toggle that enables the field. */
	control?: Snippet | undefined;
	/**
	 * Render the field itself. False hides the body entirely (used instead of a
	 * greyed-out box when the row's toggle is off) — and with no body there is no
	 * control to point at, so the `<label for>` is dropped with it.
	 */
	bodyVisible?: boolean;
	/** The field. Receives the id to put on the control the label binds to. */
	children: Snippet<[string]>;
} = $props();

const fieldId = $props.id();
</script>

<div class="qa-field">
	<SettingItem {name} {desc} {control} labelFor={bodyVisible ? fieldId : undefined} />
	{#if bodyVisible}
		<div class="qa-field-body">{@render children(fieldId)}</div>
	{/if}
</div>
