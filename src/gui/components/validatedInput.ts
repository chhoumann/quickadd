import type { App } from "obsidian";
import { TextAreaComponent, TextComponent } from "obsidian";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";

type ValidatorResult = boolean | string | { valid: boolean; message?: string };
type Validator = (value: string) => ValidatorResult | Promise<ValidatorResult>;

export type InputKind = "text" | "textarea";

export interface ValidatedInputOptions {
	app: App;
	parent: HTMLElement;
	initialValue?: string;
	placeholder?: string;
	required?: boolean;
	requiredMessage?: string;
	validator?: Validator;
	suggestions?: string[];
	maxSuggestions?: number;
	attachSuggesters?: ((el: HTMLInputElement | HTMLTextAreaElement) => void)[];
	inputKind?: InputKind;
	debounceMs?: number;
	trim?: boolean;
	ariaHintId?: string;
	fullWidth?: boolean;
	marginBottomPx?: number;
	onChange?: (value: string) => void;
}

export interface ValidatedInputHandle {
	component: TextComponent | TextAreaComponent;
	inputEl: HTMLInputElement | HTMLTextAreaElement;
	getValue(): string;
	setValue(value: string): void;
	setDisabled(disabled: boolean): void;
	setRequired(required: boolean): void;
	updateSuggestions(items: string[]): void;
	validateNow(): Promise<boolean>;
	destroy(): void;
}

export function createValidatedInput(
	opts: ValidatedInputOptions,
): ValidatedInputHandle {
	const {
		app,
		parent,
		initialValue = "",
		placeholder,
		required = false,
		requiredMessage = "This field is required",
		validator,
		suggestions,
		maxSuggestions = Infinity,
		attachSuggesters = [],
		inputKind = "text",
		debounceMs = 0,
		trim = true,
		ariaHintId,
		fullWidth = true,
		marginBottomPx = 8,
		onChange,
	} = opts;

	const component =
		inputKind === "textarea"
			? new TextAreaComponent(parent)
			: new TextComponent(parent);

	const inputEl = component.inputEl as HTMLInputElement | HTMLTextAreaElement;

	if (fullWidth) inputEl.style.width = "100%";
	inputEl.style.marginBottom = `${marginBottomPx}px`;
	if (inputKind === "textarea") {
		(inputEl as HTMLTextAreaElement).style.minHeight = "10rem";
	}
	if (placeholder) component.setPlaceholder(placeholder);
	component.setValue(initialValue);

	const hint = parent.createDiv({ cls: "qa-field-hint" });
	hint.setAttr("aria-live", "polite");
	const generatedId =
		ariaHintId ?? `qa-hint-${Math.random().toString(36).slice(2)}`;
	hint.setAttr("id", generatedId);
	inputEl.setAttribute("aria-describedby", generatedId);

	let suggester: GenericTextSuggester | undefined;
	if (suggestions && suggestions.length) {
		suggester = new GenericTextSuggester(
			app,
			inputEl,
			suggestions,
			maxSuggestions,
		);
	}

	attachSuggesters.forEach((attach) => attach(inputEl));

	let disposed = false;
	let validateToken = 0;
	let currentRequired = required;

	const normalize = (raw: string) => (trim ? raw.trim() : raw);

	const setError = (message?: string) => {
		const show = !!message;
		inputEl.toggleClass("is-invalid", show);
		inputEl.setAttribute("aria-invalid", String(show));
		hint.textContent = message ?? "";
	};

	const runValidator = async (value: string): Promise<boolean> => {
		if (currentRequired && normalize(value).length === 0) {
			setError(requiredMessage);
			return false;
		}
		if (!validator) {
			setError(undefined);
			return true;
		}

		const myToken = ++validateToken;
		const res = await Promise.resolve(validator(value));
		if (myToken !== validateToken || disposed) return true;

		let valid: boolean;
		let message: string | undefined;
		if (typeof res === "boolean") {
			valid = res;
			message = res ? undefined : "Invalid value";
		} else if (typeof res === "string") {
			valid = false;
			message = res;
		} else {
			valid = res.valid;
			message = res.message;
		}

		setError(valid ? undefined : message ?? "Invalid value");
		return valid;
	};

	let timer: number | undefined;
	const handleChange = (value: string) => {
		if (onChange) onChange(value);
		if (debounceMs > 0) {
			if (timer) window.clearTimeout(timer);
			timer = window.setTimeout(() => void runValidator(value), debounceMs);
		} else {
			void runValidator(value);
		}
	};

	component.onChange(handleChange);
	void runValidator(initialValue);

	return {
		component,
		inputEl,
		getValue: () => inputEl.value,
		setValue: (v: string) => {
			component.setValue(v);
			void runValidator(v);
		},
		setDisabled: (disabled: boolean) => component.setDisabled(disabled),
		setRequired: (req: boolean) => {
			currentRequired = req;
			void runValidator(inputEl.value);
		},
		updateSuggestions: (items: string[]) => {
			if (!suggester) {
				if (items && items.length) {
					suggester = new GenericTextSuggester(
						app,
						inputEl,
						items,
						maxSuggestions,
					);
				}
				return;
			}
			suggester.close();
			suggester = new GenericTextSuggester(app, inputEl, items, maxSuggestions);
		},
		validateNow: () => runValidator(inputEl.value),
		destroy: () => {
			disposed = true;
			if (timer) window.clearTimeout(timer);
			hint.detach();
		},
	};
}
