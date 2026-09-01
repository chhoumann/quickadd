import type { DateOrigin, DateOriginUnit } from "./dateOrigin";

export const DATE_ORIGIN_PRESETS = [
	"today",
	"ask",
	"yesterday",
	"last-week",
	"next-week",
	"last-month",
	"custom",
	"variable",
] as const;

export type DateOriginPreset = (typeof DATE_ORIGIN_PRESETS)[number];

export const DATE_ORIGIN_SETTING_NAME = "Which day";
export const DATE_ORIGIN_SETTING_DESC =
	"The day {{DATE}} writes. The clock stays now.";

export const ANOTHER_DAY_COMMAND_SETTING_NAME = "Also add (another day)";
export const ANOTHER_DAY_COMMAND_SETTING_DESC =
	"Registers Name (another day) in the command palette when this choice is a command. Hold Shift in the QuickAdd menu always opens the picker, with or without this.";

export const ASK_DEFAULT_SETTING_NAME = "Picker starts on";
export const ASK_DEFAULT_SETTING_DESC =
	"The date the picker suggests first. You can still pick a different day.";

export const CUSTOM_OFFSET_SETTING_NAME = "How far from today";
export const CUSTOM_OFFSET_SETTING_DESC =
	"How many days, weeks, months, or years from today. Negative is the past.";

export const VARIABLE_SETTING_NAME = "Variable name";
export const VARIABLE_SETTING_DESC =
	"A VDATE or script value that already has the day.";

export const NAMED_RELATIVE_PRESETS = [
	{ id: "yesterday", label: "Yesterday", offset: -1, unit: "days" },
	{ id: "last-week", label: "Last week", offset: -1, unit: "weeks" },
	{ id: "next-week", label: "Next week", offset: 1, unit: "weeks" },
	{ id: "last-month", label: "Last month", offset: -1, unit: "months" },
] as const satisfies readonly {
	id: DateOriginPreset;
	label: string;
	offset: number;
	unit: DateOriginUnit;
}[];

export const DATE_ORIGIN_PRESET_OPTIONS: {
	value: DateOriginPreset;
	label: string;
}[] = [
	{ value: "today", label: "Today" },
	{ value: "ask", label: "Ask each time" },
	...NAMED_RELATIVE_PRESETS.map((item) => ({
		value: item.id,
		label: item.label,
	})),
	{ value: "custom", label: "Custom…" },
	{ value: "variable", label: "A variable…" },
];

export const ASK_DEFAULT_PRESETS = [
	{ id: "today", label: "Today", defaultValue: undefined, aliases: ["", "today"] },
	{
		id: "yesterday",
		label: "Yesterday",
		defaultValue: "yesterday",
		aliases: ["yesterday", "yd"],
	},
	{
		id: "last-week",
		label: "Last week",
		defaultValue: "last week",
		aliases: ["last week", "lw"],
	},
	{
		id: "next-week",
		label: "Next week",
		defaultValue: "next week",
		aliases: ["next week", "nw"],
	},
	{
		id: "last-month",
		label: "Last month",
		defaultValue: "last month",
		aliases: ["last month", "lm"],
	},
] as const;

const DATE_ORIGIN_PRESET_IDS = new Set<string>(DATE_ORIGIN_PRESETS);

export function isDateOriginPreset(value: string): value is DateOriginPreset {
	return DATE_ORIGIN_PRESET_IDS.has(value);
}

export function dateOriginToPreset(
	origin: DateOrigin | undefined,
): DateOriginPreset {
	if (!origin || origin.kind === "now") return "today";
	if (origin.kind === "ask") return "ask";
	if (origin.kind === "variable") return "variable";

	for (const named of NAMED_RELATIVE_PRESETS) {
		if (origin.offset === named.offset && origin.unit === named.unit) {
			return named.id;
		}
	}
	return "custom";
}

export function dateOriginFromPreset(input: {
	preset: DateOriginPreset;
	previous?: DateOrigin;
}): DateOrigin | undefined {
	const { preset, previous } = input;

	if (preset === "today") return undefined;

	if (preset === "ask") {
		if (previous?.kind === "ask") return previous;
		return askOriginFromNamedDay(dateOriginToPreset(previous));
	}

	if (preset === "variable") {
		return previous?.kind === "variable"
			? previous
			: { kind: "variable", name: "" };
	}

	if (preset === "custom") {
		if (
			previous?.kind === "relative" &&
			dateOriginToPreset(previous) === "custom"
		) {
			return previous;
		}
		return { kind: "relative", offset: -2, unit: "days" };
	}

	for (const named of NAMED_RELATIVE_PRESETS) {
		if (named.id === preset) {
			return {
				kind: "relative",
				offset: named.offset,
				unit: named.unit,
			};
		}
	}

	return undefined;
}

function askOriginFromNamedDay(preset: DateOriginPreset): DateOrigin {
	for (const item of ASK_DEFAULT_PRESETS) {
		if (item.id === preset && item.defaultValue) {
			return { kind: "ask", defaultValue: item.defaultValue };
		}
	}
	return { kind: "ask" };
}

export function askDefaultToPresetId(defaultValue?: string): string {
	const normalized = (defaultValue ?? "").trim().toLowerCase();
	for (const item of ASK_DEFAULT_PRESETS) {
		if (item.aliases.some((alias) => alias === normalized)) {
			return item.id;
		}
	}
	return "kept";
}

export function askDefaultOptions(
	defaultValue?: string,
): { value: string; label: string }[] {
	const options: { value: string; label: string }[] = ASK_DEFAULT_PRESETS.map(
		(item) => ({
			value: item.id,
			label: item.label,
		}),
	);
	if (askDefaultToPresetId(defaultValue) === "kept") {
		const kept = defaultValue?.trim();
		if (kept) {
			options.push({ value: "kept", label: kept });
		}
	}
	return options;
}

export function askDefaultFromPresetId(
	id: string,
	previous?: string,
): string | undefined {
	if (id === "kept") {
		const trimmed = previous?.trim();
		return trimmed ? trimmed : undefined;
	}
	for (const item of ASK_DEFAULT_PRESETS) {
		if (item.id === id) return item.defaultValue;
	}
	return undefined;
}

export function isPickDateToken(value: unknown): boolean {
	return typeof value === "string" && value.trim().toLowerCase() === "ask";
}

export function shouldRegisterAnotherDayCommand(input: {
	origin?: DateOrigin;
	enabled?: boolean;
}): boolean {
	if (!input.enabled) return false;
	return dateOriginToPreset(input.origin) !== "ask";
}

export function choiceCommandId(choiceId: string): string {
	return `choice:${choiceId}`;
}

export function anotherDayCommandId(choiceId: string): string {
	return `${choiceCommandId(choiceId)}:another-day`;
}

export function anotherDayCommandName(choiceName: string): string {
	return `${choiceName} (another day)`;
}

export function dateOriginForPick(
	origin: DateOrigin | undefined,
): DateOrigin {
	if (origin?.kind === "ask") return origin;
	return askOriginFromNamedDay(dateOriginToPreset(origin));
}
