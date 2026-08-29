<script lang="ts">
import type { DateOrigin } from "../../../types/dateOrigin";
import { DATE_ORIGIN_UNITS, isDateOriginUnit } from "../../../types/dateOrigin";
import {
	ASK_DEFAULT_SETTING_DESC,
	ASK_DEFAULT_SETTING_NAME,
	CUSTOM_OFFSET_SETTING_DESC,
	CUSTOM_OFFSET_SETTING_NAME,
	DATE_ORIGIN_PRESET_OPTIONS,
	DATE_ORIGIN_SETTING_DESC,
	DATE_ORIGIN_SETTING_NAME,
	VARIABLE_SETTING_DESC,
	VARIABLE_SETTING_NAME,
	askDefaultFromPresetId,
	askDefaultOptions,
	askDefaultToPresetId,
	dateOriginFromPreset,
	dateOriginToPreset,
	isDateOriginPreset,
} from "../../../types/dateOriginPresets";
import SettingItem from "../../components/SettingItem.svelte";
import Dropdown from "../../components/Dropdown.svelte";

let {
	dateOrigin = $bindable(),
}: {
	dateOrigin: DateOrigin | undefined;
} = $props();

const unitOptions = DATE_ORIGIN_UNITS.map((unit) => ({
	value: unit,
	label: unit,
}));

const selectedPreset = $derived(dateOriginToPreset(dateOrigin));
const askOrigin = $derived(dateOrigin?.kind === "ask" ? dateOrigin : undefined);
const customOrigin = $derived(
	selectedPreset === "custom" && dateOrigin?.kind === "relative"
		? dateOrigin
		: undefined,
);
const variableOrigin = $derived(
	dateOrigin?.kind === "variable" ? dateOrigin : undefined,
);
const askDefaultId = $derived(askDefaultToPresetId(askOrigin?.defaultValue));
const askDefaultChoices = $derived(askDefaultOptions(askOrigin?.defaultValue));

function onPresetChange(value: string) {
	if (!isDateOriginPreset(value)) return;
	dateOrigin = dateOriginFromPreset({
		preset: value,
		previous: dateOrigin,
	});
}

function onAskDefaultChange(value: string) {
	if (dateOrigin?.kind !== "ask") return;
	const defaultValue = askDefaultFromPresetId(value, dateOrigin.defaultValue);
	dateOrigin = defaultValue
		? { kind: "ask", defaultValue }
		: { kind: "ask" };
}

function onOffsetChange(value: string) {
	if (dateOrigin?.kind !== "relative") return;
	const trimmed = value.trim();
	if (!/^[+-]?\d+$/.test(trimmed)) return;
	dateOrigin = { ...dateOrigin, offset: Number(trimmed) };
}

function onUnitChange(value: string) {
	if (dateOrigin?.kind !== "relative") return;
	if (!isDateOriginUnit(value)) return;
	dateOrigin = { ...dateOrigin, unit: value };
}

function onVariableChange(value: string) {
	if (dateOrigin?.kind !== "variable") return;
	dateOrigin = { kind: "variable", name: value };
}
</script>

<SettingItem name={DATE_ORIGIN_SETTING_NAME} desc={DATE_ORIGIN_SETTING_DESC}>
	{#snippet control()}
		<Dropdown
			value={selectedPreset}
			options={DATE_ORIGIN_PRESET_OPTIONS}
			onchange={onPresetChange}
		/>
	{/snippet}
</SettingItem>

{#if askOrigin}
	<SettingItem name={ASK_DEFAULT_SETTING_NAME} desc={ASK_DEFAULT_SETTING_DESC}>
		{#snippet control()}
			<Dropdown
				value={askDefaultId}
				options={askDefaultChoices}
				onchange={onAskDefaultChange}
			/>
		{/snippet}
	</SettingItem>
{/if}

{#if customOrigin}
	<SettingItem
		name={CUSTOM_OFFSET_SETTING_NAME}
		desc={CUSTOM_OFFSET_SETTING_DESC}
	>
		{#snippet control()}
			<input
				type="text"
				class="qa-validated-input-full-width"
				value={String(customOrigin.offset)}
				placeholder="-2"
				aria-label={CUSTOM_OFFSET_SETTING_NAME}
				oninput={(event) => {
					const target = event.currentTarget;
					if (!(target instanceof HTMLInputElement)) return;
					onOffsetChange(target.value);
				}}
			/>
			<Dropdown
				value={customOrigin.unit}
				options={unitOptions}
				onchange={onUnitChange}
			/>
		{/snippet}
	</SettingItem>
{/if}

{#if variableOrigin}
	<SettingItem name={VARIABLE_SETTING_NAME} desc={VARIABLE_SETTING_DESC}>
		{#snippet control()}
			<input
				type="text"
				class="qa-validated-input-full-width"
				value={variableOrigin.name}
				placeholder="day"
				aria-label={VARIABLE_SETTING_NAME}
				oninput={(event) => {
					const target = event.currentTarget;
					if (!(target instanceof HTMLInputElement)) return;
					onVariableChange(target.value);
				}}
			/>
		{/snippet}
	</SettingItem>
{/if}
