/** Wire shapes and reply validation shared by the server and remote provider. */
export interface SuggesterItem {
	/** Text shown to the user. */
	title: string;
	/** The value handed back to the script when this item is chosen. */
	value: string;
}

export interface CheckboxItem {
	title: string;
	value: string;
	checked: boolean;
}

/** One field of a batch `requestInputs` form (a subset of QuickAdd's FieldRequirement). */
export interface FormField {
	id: string;
	label: string;
	type:
		| "text"
		| "number"
		| "textarea"
		| "dropdown"
		| "date"
		| "suggester"
		| "slider"
		| "field-suggest";
	placeholder?: string;
	defaultValue?: string;
	description?: string;
	options?: string[];
	displayOptions?: string[];
	dateFormat?: string;
	optional?: boolean;
	numericConfig?: { min?: number; max?: number; step?: number };
	suggesterConfig?: { allowCustomInput?: boolean; multiSelect?: boolean };
}

/**
 * A prompt the running script is blocked on. Mirrors the QuickAdd API prompt
 * seam (suggester / inputPrompt / wideInputPrompt / datePrompt / yesNoPrompt /
 * checkboxPrompt / infoDialog). The reply `value` type per prompt:
 *  - suggester/input/date -> string   - confirm -> boolean
 *  - checkbox -> string[]             - info -> acknowledgement (any)
 */
export type PromptSpec =
	| {
			type: "suggester";
			placeholder?: string;
			allowCustomInput: boolean;
			items: SuggesterItem[];
	  }
	| {
			type: "multiselect";
			placeholder?: string;
			allowCustomInput: boolean;
			items: SuggesterItem[];
			/** `value`s (wire tokens) that start pre-selected. */
			preselected: string[];
	  }
	| {
			type: "input";
			header: string;
			placeholder?: string;
			defaultValue?: string;
			/** Render a multi-line field (wideInputPrompt). */
			multiline: boolean;
	  }
	| {
			type: "date";
			header: string;
			placeholder?: string;
			defaultValue?: string;
			dateFormat?: string;
			/** Render a date *and time* picker (VDATE `|time`/`|datetime`). */
			withTime?: boolean;
	  }
	| { type: "confirm"; header: string; text?: string }
	| { type: "checkbox"; header?: string; items: CheckboxItem[] }
	| { type: "info"; header: string; text: string[] }
	| { type: "form"; fields: FormField[] };

/** Body of a `POST /reply`. Every field is untrusted JSON, hence the `unknown`s. */
export interface ReplyBody {
	requestId?: string;
	value?: unknown;
	cancelled?: unknown;
}

export type ReplyOutcome =
	| { ok: true }
	| { ok: false; status: 400 | 409; error: string };

export function confirmReply(value: unknown): boolean | undefined {
	if (value === true || value === "true") return true;
	if (value === false || value === "false") return false;
	return undefined;
}

export function describeReplyProblem(
	promptType: PromptSpec["type"],
	body: ReplyBody,
): string | null {
	if (body.cancelled !== undefined && typeof body.cancelled !== "boolean") {
		return 'The "cancelled" flag must be the literal true (or omitted). A cancel that is not recognised would otherwise be answered on the user\'s behalf.';
	}
	if (body.cancelled === true) return null;

	if (promptType === "confirm") {
		const value = body.value;
		if (confirmReply(value) === undefined) {
			return `A confirm prompt needs a boolean reply, or {"cancelled": true} if the user dismissed it. Got ${describeValue(value)}.`;
		}
	}
	return null;
}

/** A short, safe rendering of a bad reply value for an error message. */
export function describeValue(value: unknown): string {
	if (value === undefined) return "no value";
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value.slice(0, 40));
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return Array.isArray(value) ? "an array" : typeof value;
}

