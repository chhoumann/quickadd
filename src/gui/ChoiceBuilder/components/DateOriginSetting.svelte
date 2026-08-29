<script lang="ts">
import type { DateOrigin, DateOriginUnit } from "../../../types/dateOrigin";
import { DATE_ORIGIN_UNITS } from "../../../types/dateOrigin";
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";

let {
	dateOrigin = $bindable(),
}: {
	dateOrigin: DateOrigin | undefined;
} = $props();

const kindOptions = [
	{ value: "", label: "Today" },
	{ value: "ask", label: "Ask" },
	{ value: "relative", label: "Relative" },
	{ value: "variable", label: "From variable" },
];

const unitOptions = DATE_ORIGIN_UNITS.map((unit) => ({
	value: unit,
	label: unit,
}));

const selectedKind = $derived(dateOrigin?.kind === "now" ? "" : (dateOrigin?.kind ?? ""));

function onKindChange(value: string) {
	if (value === "ask") {
		dateOrigin = { kind: "ask" };
		return;
	}
	if (value === "relative") {
		dateOrigin = { kind: "relative", offset: -1, unit: "weeks" };
		return;
	}
	if (value === "variable") {
		dateOrigin = { kind: "variable", name: "" };
		return;
	}
	dateOrigin = undefined;
}

function onDefaultChange(value: string) {
	if (dateOrigin?.kind !== "ask") return;
	const trimmed = value.trim();
	dateOrigin = trimmed ? { kind: "ask", defaultValue: trimmed } : { kind: "ask" };
}

function onOffsetChange(value: string) {
	if (dateOrigin?.kind !== "relative") return;
	const offset = Number.parseInt(value, 10);
	if (!Number.isInteger(offset)) return;
	dateOrigin = { ...dateOrigin, offset };
}

function onUnitChange(value: string) {
	if (dateOrigin?.kind !== "relative") return;
	if (!(DATE_ORIGIN_UNITS as readonly string[]).includes(value)) return;
	dateOrigin = { ...dateOrigin, unit: value as DateOriginUnit };
}

function onVariableChange(value: string) {
	if (dateOrigin?.kind !== "variable") return;
	dateOrigin = { kind: "variable", name: value };
}
</script>

<SettingItem
	name="Date origin"
	desc={"Which day {{DATE}} formats and offsets from. Time tokens stay the current clock. Today is the default. Ask uses the date picker (lw, last week, a calendar click). Relative is for a last-week or next-year hotkey. From variable reads a VDATE or script value."}
>
	{#snippet control()}
		<Dropdown value={selectedKind} options={kindOptions} onchange={onKindChange} />
	{/snippet}
</SettingItem>

{#if dateOrigin?.kind === "ask"}
	<SettingItem
		name="Date origin default"
		desc="Natural language shown in the picker, such as today or last week. Leave empty for today."
	>
		{#snippet control()}
			<input
				type="text"
				class="qa-validated-input-full-width"
				value={dateOrigin.defaultValue ?? ""}
				placeholder="today"
				aria-label="Date origin default"
				oninput={(event) =>
					onDefaultChange((event.currentTarget as HTMLInputElement).value)}
			/>
		{/snippet}
	</SettingItem>
{/if}

{#if dateOrigin?.kind === "relative"}
	<SettingItem
		name="Date origin offset"
		desc="Move the origin from today. −1 week is last week."
	>
		{#snippet control()}
			<input
				type="text"
				class="qa-validated-input-full-width"
				value={String(dateOrigin.offset)}
				placeholder="-1"
				aria-label="Date origin offset"
				oninput={(event) =>
					onOffsetChange((event.currentTarget as HTMLInputElement).value)}
			/>
			<Dropdown
				value={dateOrigin.unit}
				options={unitOptions}
				onchange={onUnitChange}
			/>
		{/snippet}
	</SettingItem>
{/if}

{#if dateOrigin?.kind === "variable"}
	<SettingItem
		name="Date origin variable"
		desc="Name of a VDATE or script variable that already holds the day."
	>
		{#snippet control()}
			<input
				type="text"
				class="qa-validated-input-full-width"
				value={dateOrigin.name}
				placeholder="day"
				aria-label="Date origin variable"
				oninput={(event) =>
					onVariableChange((event.currentTarget as HTMLInputElement).value)}
			/>
		{/snippet}
	</SettingItem>
{/if}
