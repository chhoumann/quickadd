<script lang="ts">
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";

/** Replaces ChoiceBuilder.addOnePageOverrideSetting. */
let {
	onePageInput = $bindable(),
}: {
	onePageInput: "always" | "never" | undefined;
} = $props();

const options = [
	{ value: "", label: "Follow global setting" },
	{ value: "always", label: "Always" },
	{ value: "never", label: "Never" },
];

const selected = $derived((onePageInput ?? "") as string);

function onChange(value: string) {
	onePageInput =
		value === "always" || value === "never" ? value : undefined;
}
</script>

<SettingItem
	name="One-page input override"
	desc="Override the global setting for this choice. 'Always' forces the one-page modal even if disabled globally; 'Never' disables it even if enabled globally."
>
	{#snippet control()}
		<Dropdown value={selected} {options} onchange={onChange} />
	{/snippet}
</SettingItem>
