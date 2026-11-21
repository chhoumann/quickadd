import type { MultiValueFormat } from "./multiValueFormat";

export type ValueInputType =
	| "multiline"
	| "number"
	| "slider"
	| "checkbox"
	| "text";

export type NumericInputConfig = {
	min?: number;
	max?: number;
	step?: number;
};

export type SliderConfig = {
	min: number;
	max: number;
	step: number;
};

export type MultiEmit = "text" | "linklist";

export type ParsedOptions = {
	label?: string;
	caseStyle?: string;
	defaultValue: string;
	allowCustomInput: boolean;
	usesOptions: boolean;
	inputTypeOverride?: string;
	minRaw?: string;
	maxRaw?: string;
	stepRaw?: string;
	displayValuesRaw?: string;
	optionalExplicit?: boolean;
	trimExplicit?: boolean;
	name?: string;
	multiSelect?: boolean;
	multiEmit?: MultiEmit;
	multiFormat?: MultiValueFormat;
};
