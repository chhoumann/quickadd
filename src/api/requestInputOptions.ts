import { normalizeDisplayItem } from "../gui/suggesters/utils";
import type { NumericInputConfig } from "../utils/valueSyntax";

export type RequestInputDisplayOptions<T = string> =
	| readonly string[]
	| ((value: T, index: number, arr: readonly T[]) => string);

export interface RequestInputSuggesterConfig<T = string> {
	allowCustomInput?: boolean;
	caseSensitive?: boolean;
	multiSelect?: boolean;
	/** Multi-select: return the picks as an array instead of one joined string. */
	returnArray?: boolean;
	/** Multi-select: joins the picks when they are returned as one string. Defaults to ", ". */
	separator?: string;
	renderItem?: (value: T, el: HTMLElement) => void;
}

export interface RequestSliderConfig {
	min: number;
	max: number;
	step?: number;
}

export interface RequestInputSpec<T = string> {
	id: string;
	label?: string;
	type:
		| "text"
		| "number"
		| "textarea"
		| "dropdown"
		| "date"
		| "field-suggest"
		| "suggester"
		| "slider";
	placeholder?: string;
	defaultValue?: string | NoInfer<T> | readonly (string | NoInfer<T>)[];
	numericConfig?: NumericInputConfig;
	sliderConfig?: RequestSliderConfig;
	options?: readonly T[];
	displayOptions?: RequestInputDisplayOptions<NoInfer<T>>;
	dateFormat?: string;
	description?: string;
	optional?: boolean;
	suggesterConfig?: RequestInputSuggesterConfig<NoInfer<T>>;
}

/** A spec whose answer is always a string: string options and no `returnArray`. */
export type StringRequestInputSpec = Omit<RequestInputSpec, "suggesterConfig"> & {
	suggesterConfig?: Omit<RequestInputSuggesterConfig, "returnArray"> & { returnArray?: false };
};

export interface EncodedRequestInputOptions {
	options?: string[];
	displayOptions?: string[];
	defaultValue?: string;
	defaultValues?: string[];
	renderOption?: (value: string, el: HTMLElement) => void;
	decode: (answer: string) => unknown;
	text: (answer: string) => string;
}

const OPTION_TOKEN_PREFIX = `${String.fromCharCode(0)}qa-opt:`;

function optionLabel<T>(
	display: RequestInputDisplayOptions<T> | undefined,
	option: T,
	index: number,
	raw: readonly T[],
): string {
	return normalizeDisplayItem(
		typeof display === "function" ? display(option, index, raw) : (display?.[index] ?? option),
	);
}

export function encodeRequestInputOptions<T>(spec: RequestInputSpec<T>): EncodedRequestInputOptions {
	const raw = spec.options ? [...spec.options] : [];
	const display = spec.displayOptions;
	const labels = raw.map((option, index) => optionLabel(display, option, index, raw));
	const tokens = needsTokens(raw, labels);
	const wire = raw.map((option, index) => (tokens ? `${OPTION_TOKEN_PREFIX}${index}` : (option as string)));
	const encode = (value: unknown): string => {
		const index = raw.indexOf(value as T);
		return index >= 0 ? wire[index] : normalizeDisplayItem(value);
	};
	const decode = (answer: string): unknown => {
		const index = wire.indexOf(answer);
		return index >= 0 ? raw[index] : answer;
	};
	const renderItem = spec.suggesterConfig?.renderItem;
	const defaults = spec.defaultValue as unknown;
	const multiSelect = isMultiSelectSuggester(spec);
	const defaultIsOption = defaults !== undefined && raw.indexOf(defaults as T) >= 0;

	return {
		options: spec.options ? wire : undefined,
		displayOptions: tokens || display !== undefined ? labels : undefined,
		defaultValue: defaultIsOption
			? encode(defaults)
			: Array.isArray(defaults)
				? (multiSelect || defaults.length === 0 ? undefined : encode(defaults[0]))
				: (defaults === undefined ? undefined : encode(defaults)),
		defaultValues: multiSelect && !defaultIsOption && Array.isArray(defaults) ? defaults.map(encode) : undefined,
		renderOption: renderItem && ((answer, el) => renderItem(decode(answer) as T, el)),
		decode,
		text: (answer) => {
			const index = wire.indexOf(answer);
			if (index < 0) return answer;
			const option = raw[index];
			return typeof option === "string" ? option : labels[index];
		},
	};
}

function needsTokens(raw: readonly unknown[], labels: string[]): boolean {
	const labelByValue = new Map<string, string>();
	return raw.some((option, index) => {
		if (typeof option !== "string" || option.startsWith(OPTION_TOKEN_PREFIX)) return true;
		const label = labelByValue.get(option);
		if (label === undefined) labelByValue.set(option, labels[index]);
		return label !== undefined && label !== labels[index];
	});
}

export function isMultiSelectSuggester(spec: Pick<RequestInputSpec<unknown>, "type" | "suggesterConfig">): boolean {
	return spec.type === "suggester" && spec.suggesterConfig?.multiSelect === true;
}

export function multiSelectSeparator(spec: Pick<RequestInputSpec<unknown>, "suggesterConfig">): string {
	return spec.suggesterConfig?.separator ?? ", ";
}

export function hasNonStringOptions(options: readonly unknown[] | undefined): boolean {
	return options?.some((option) => typeof option !== "string") ?? false;
}

export function shouldReturnArray(
	spec: Pick<RequestInputSpec<unknown>, "type" | "options" | "suggesterConfig">,
): boolean {
	if (!isMultiSelectSuggester(spec)) return false;
	return spec.suggesterConfig?.returnArray ??
		(hasNonStringOptions(spec.options) && spec.suggesterConfig?.separator === undefined);
}

export function resolveExistingVariableValue(spec: RequestInputSpec<unknown>, value: unknown): unknown {
	if (shouldReturnArray(spec)) {
		if (Array.isArray(value)) return value;
		return value === "" ? [] : [value];
	}
	if (isMultiSelectSuggester(spec)) {
		const raw = spec.options ?? [];
		const items = Array.isArray(value) ? value : (value === "" ? [] : [value]);
		return items
			.map((item) => {
				if (typeof item === "string") return item;
				const index = raw.indexOf(item);
				return index >= 0
					? optionLabel(spec.displayOptions, raw[index], index, raw)
					: normalizeDisplayItem(item);
			})
			.join(multiSelectSeparator(spec));
	}
	if ((spec.type === "suggester" || spec.type === "dropdown") && hasNonStringOptions(spec.options)) {
		return value;
	}
	return String(value);
}
