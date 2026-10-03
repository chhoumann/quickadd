<script lang="ts">
import type { App } from "obsidian";
import { GenericTextSuggester } from "../../suggesters/genericTextSuggester";
import type { TextInputSuggest } from "../../suggesters/suggest";
import { suggester } from "./suggesterAction";
import { indentOnTab } from "../../components/textareaIndent";

type AnySuggest = Pick<TextInputSuggest<unknown>, "destroy">;
type HintVariant = "neutral" | "success";
type ValidatorResult =
	| boolean
	| string
	| { valid: boolean; message?: string; variant?: HintVariant };
type Validator = (
	value: string,
) => ValidatorResult | Promise<ValidatorResult>;
type SuggesterFactory = (
	el: HTMLInputElement | HTMLTextAreaElement,
) => AnySuggest | void;

/**
 * Svelte port of createValidatedInput (validatedInput.ts). Owns its own
 * <input>/<textarea> so the value round-trips through the binding when a
 * suggester writes it. Keeps the monotonic `validateToken` staleness guard,
 * trim normalization, initial + required-change validation, and the aria-live
 * hint. The former imperative `reload()` callers now react to `value` changes.
 */
let {
	value = $bindable(""),
	placeholder = undefined,
	inputKind = "text",
	required = false,
	requiredMessage = "This field is required",
	disabled = false,
	validator = undefined,
	trim = true,
	suggestions = undefined,
	maxSuggestions = Infinity,
	makeSuggesters = [],
	app = undefined,
	id = undefined,
	ariaLabel = undefined,
	onChange = undefined,
}: {
	value?: string;
	placeholder?: string | undefined;
	inputKind?: "text" | "textarea";
	required?: boolean;
	requiredMessage?: string;
	disabled?: boolean;
	validator?: Validator | undefined;
	trim?: boolean;
	suggestions?: string[] | undefined;
	maxSuggestions?: number;
	makeSuggesters?: SuggesterFactory[];
	app?: App | undefined;
	/** Set by LabeledField so the row's `<label for>` binds to this control. */
	id?: string | undefined;
	ariaLabel?: string | undefined;
	onChange?: ((value: string) => void) | undefined;
} = $props();

let invalid = $state(false);
// A required field stays neutral until the user has typed in it or left it:
// flagging a field they haven't reached yet is noise (#2034).
let touched = $state(false);
let hintMessage = $state("");
let hintVariant = $state<HintVariant>("neutral");
let validateToken = 0;
let disposed = false;
const hintId = `qa-hint-${Math.random().toString(36).slice(2)}`;

const normalize = (raw: string) => (trim ? raw.trim() : raw);

// Shows the hint message; marks the field invalid only when isInvalid. A valid
// result that still carries a message renders as a neutral hint (not an error),
// e.g. a template path with format syntax that "resolves at run time".
function setHint(
	message?: string,
	isInvalid = false,
	variant: HintVariant = "neutral",
) {
	invalid = isInvalid;
	hintMessage = message ?? "";
	hintVariant = isInvalid ? "neutral" : variant;
}

async function runValidator(candidate: string): Promise<boolean> {
	if (required && normalize(candidate).length === 0) {
		setHint(touched ? requiredMessage : undefined, touched);
		return false;
	}
	if (!validator) {
		setHint(undefined);
		return true;
	}
	const myToken = ++validateToken;
	const res = await Promise.resolve(validator(candidate));
	if (myToken !== validateToken || disposed) return true;

	if (typeof res === "boolean") {
		setHint(res ? undefined : "Invalid value", !res);
		return res;
	}
	if (typeof res === "string") {
		setHint(res, true);
		return false;
	}
	setHint(
		res.message ?? (res.valid ? undefined : "Invalid value"),
		!res.valid,
		res.valid ? (res.variant ?? "neutral") : "neutral",
	);
	return res.valid;
}

function handleInput(event: Event) {
	const next = (event.currentTarget as HTMLInputElement | HTMLTextAreaElement)
		.value;
	touched = true;
	value = next;
	onChange?.(next);
}

// Initial validation on mount + re-validate when `value` or `required` change
// (mirrors createValidatedInput's runValidator(initialValue) + setRequired()).
$effect(() => {
	void required;
	void touched;
	const current = value;
	void runValidator(current);
});

$effect(() => () => {
	disposed = true;
});

function attach(el: HTMLInputElement | HTMLTextAreaElement): AnySuggest[] {
	const made: AnySuggest[] = [];
	if (app && suggestions && suggestions.length) {
		made.push(new GenericTextSuggester(app, el, suggestions, maxSuggestions));
	}
	for (const make of makeSuggesters) {
		const instance = make(el);
		if (instance) made.push(instance);
	}
	return made;
}
</script>

<!-- Paths, tokens and format strings: a spellchecker only underlines them. -->
{#if inputKind === "textarea"}
	<textarea
		class="qa-validated-input-full-width qa-validated-input-margin-8 qa-validated-input-textarea"
		class:is-invalid={invalid}
		class:is-valid={!invalid && hintVariant === "success" && hintMessage.length > 0}
		{id}
		{placeholder}
		{disabled}
		aria-label={ariaLabel}
		aria-invalid={invalid}
		aria-describedby={hintId}
		spellcheck={false}
		{value}
		oninput={handleInput}
		onblur={() => (touched = true)}
		use:suggester={attach}
		use:indentOnTab
	></textarea>
{:else}
	<input
		type="text"
		class="qa-validated-input-full-width qa-validated-input-margin-8"
		class:is-invalid={invalid}
		class:is-valid={!invalid && hintVariant === "success" && hintMessage.length > 0}
		{id}
		{placeholder}
		{disabled}
		aria-label={ariaLabel}
		aria-invalid={invalid}
		aria-describedby={hintId}
		spellcheck={false}
		{value}
		oninput={handleInput}
		onblur={() => (touched = true)}
		use:suggester={attach}
	/>
{/if}
<div
	class="qa-field-hint"
	class:qa-field-hint--neutral={!invalid && hintVariant === "neutral"}
	class:qa-field-hint--success={!invalid && hintVariant === "success"}
	id={hintId}
	aria-live="polite"
>{hintMessage}</div>
