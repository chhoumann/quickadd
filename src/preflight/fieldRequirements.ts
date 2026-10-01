import type { NumericInputConfig, SliderConfig } from "src/utils/valueSyntax";

export type FieldType =
	| "text"
	| "number"
	| "textarea"
	| "dropdown"
	| "slider"
	| "date"
	| "field-suggest"
	| "file-picker"
	| "suggester";

export interface FieldRequirement {
	id: string; // variable key or special input id
	label: string; // user-facing label
	type: FieldType;
	description?: string;
	placeholder?: string;
	defaultValue?: string;
	numericConfig?: NumericInputConfig;
	sliderConfig?: SliderConfig;
	options?: string[]; // for dropdowns and suggesters
	displayOptions?: string[]; // visible labels for mapped VALUE lists
	optionAliases?: string[][]; // file-picker: each option's note aliases, also matched
	// Additional metadata
	dateFormat?: string; // for VDATE
	withTime?: boolean; // VDATE |time/|datetime: render a date AND time picker
	multiEmit?: "text" | "linklist"; // |multi:linklist wraps picks as [[name]]
	filters?: string; // serialized filters for FIELD variables
	source?: "collected" | "script"; // provenance for UX badges
	/** Any path usage disables image paste for every occurrence of this field. */
	pathContext?: boolean;
	/** Prompt at runtime instead of the one-page form when the form has no safe widget. */
	runtimeOnly?: boolean;
	/** file-picker: a custom value is a new note, so a name any note in the vault has is not offered. */
	newNoteNameOnly?: boolean;
	/** True only when EVERY scanned occurrence of the variable is |optional. */
	optional?: boolean;
	suggesterConfig?: {
		allowCustomInput?: boolean;
		caseSensitive?: boolean;
		multiSelect?: boolean;
	};
	group?: FieldGroup;
}

export interface FieldGroup {
	id: string;
	label: string;
}
