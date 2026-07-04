/**
 * Abstraction the QuickAdd API prompt methods consult before opening an Obsidian
 * modal. When a choice executor carries a provider (a remote interactive session
 * driven by an external front end), prompts are routed to it instead of the app.
 *
 * Covers the full script prompt seam: suggester / inputPrompt / wideInputPrompt /
 * datePrompt / yesNoPrompt / checkboxPrompt / infoDialog. Each method returns
 * exactly what its in-app counterpart returns, so a script cannot tell it was
 * driven remotely.
 */

import { formatISODate } from "../utils/dateParser";
import type { FieldRequirement } from "../preflight/RequirementCollector";
import {
	type FormField,
	interactivePromptServer,
} from "./interactivePromptServer";

/**
 * Prefix for the opaque token a suggester reply carries for a *selected* item
 * (as opposed to a custom-typed value). The NUL char makes a collision with real
 * user input effectively impossible.
 */
const SUGGESTER_INDEX_PREFIX = "\u0000qa-idx:";

export interface PromptProvider {
	/** Batch multi-field prompt (`quickAddApi.requestInputs`). Returns id -> value. */
	requestInputs(fields: FieldRequirement[]): Promise<Record<string, string>>;
	suggester(
		displayItems:
			| string[]
			| ((value: string, index?: number, arr?: string[]) => string),
		actualItems: string[],
		placeholder?: string,
		allowCustomInput?: boolean,
	): Promise<unknown>;
	/**
	 * Multi-select over a fixed list (`{{VALUE:a,b|multi}}`, `{{FIELD|multi}}`,
	 * `{{FILE|multi}}`). Returns the selected `actualItems` entries in list order.
	 */
	suggesterMulti(
		displayItems: string[],
		actualItems: string[],
		options?: {
			placeholder?: string;
			allowCustomInput?: boolean;
			preselected?: string[];
		},
	): Promise<string[]>;
	inputPrompt(
		header: string,
		placeholder?: string,
		value?: string,
	): Promise<string>;
	wideInputPrompt(
		header: string,
		placeholder?: string,
		value?: string,
	): Promise<string>;
	datePrompt(
		header: string,
		options?: {
			placeholder?: string;
			defaultValue?: string;
			dateFormat?: string;
			withTime?: boolean;
		},
	): Promise<string>;
	yesNoPrompt(header: string, text?: string): Promise<boolean>;
	checkboxPrompt(
		items: string[],
		selectedItems?: string[],
		header?: string,
	): Promise<string[]>;
	infoDialog(header: string, text: string[] | string): Promise<void>;
}

/** Routes prompts to a connected front end over the interactive server session. */
export class RemotePromptProvider implements PromptProvider {
	constructor(
		private readonly sessionId: string,
		private readonly server = interactivePromptServer,
	) {}

	async suggester(
		displayItems:
			| string[]
			| ((value: string, index?: number, arr?: string[]) => string),
		actualItems: string[],
		placeholder?: string,
		allowCustomInput = false,
	): Promise<unknown> {
		const displays =
			typeof displayItems === "function"
				? actualItems.map((value, index, arr) =>
						String(displayItems(value, index, arr)),
					)
				: displayItems.map((label) => String(label));

		// Wire the reply as an opaque index token so we can map it back to the
		// ORIGINAL actualItems entry, preserving object identity exactly like
		// GenericSuggester (scripts that suggest TFiles/records read .basename etc.).
		const items = actualItems.map((value, index) => ({
			title: displays[index] ?? String(value),
			value: `${SUGGESTER_INDEX_PREFIX}${index}`,
		}));

		const answer = await this.server.emitPrompt(this.sessionId, {
			type: "suggester",
			placeholder,
			allowCustomInput,
			items,
		});
		if (answer == null) return "";
		const raw = String(answer);
		if (raw.startsWith(SUGGESTER_INDEX_PREFIX)) {
			const index = Number(raw.slice(SUGGESTER_INDEX_PREFIX.length));
			if (Number.isInteger(index) && index >= 0 && index < actualItems.length) {
				return actualItems[index];
			}
		}
		// A custom-typed value (allowCustomInput) is returned verbatim.
		return raw;
	}

	async suggesterMulti(
		displayItems: string[],
		actualItems: string[],
		options?: {
			placeholder?: string;
			allowCustomInput?: boolean;
			preselected?: string[];
		},
	): Promise<string[]> {
		const items = actualItems.map((value, index) => ({
			title: displayItems[index] ?? String(value),
			value: `${SUGGESTER_INDEX_PREFIX}${index}`,
		}));
		// Map preselected values to wire tokens so the client pre-checks them. A
		// preselected value the item list doesn't contain (e.g. a FIELD
		// default-from:active value the vault scan didn't surface) is appended as a
		// pre-checked custom item instead of being dropped - mirroring
		// MultiSuggester, which adds such defaults as custom rows.
		const preselected: string[] = [];
		for (const value of options?.preselected ?? []) {
			const index = actualItems.indexOf(value);
			if (index >= 0) {
				preselected.push(`${SUGGESTER_INDEX_PREFIX}${index}`);
			} else {
				const token = String(value);
				items.push({ title: token, value: token });
				preselected.push(token);
			}
		}

		const answer = await this.server.emitPrompt(this.sessionId, {
			type: "multiselect",
			placeholder: options?.placeholder,
			allowCustomInput: options?.allowCustomInput ?? false,
			items,
			preselected,
		});
		if (!Array.isArray(answer)) return [];
		return answer.map((raw) => {
			const value = String(raw);
			if (value.startsWith(SUGGESTER_INDEX_PREFIX)) {
				const index = Number(value.slice(SUGGESTER_INDEX_PREFIX.length));
				if (
					Number.isInteger(index) &&
					index >= 0 &&
					index < actualItems.length
				) {
					return actualItems[index];
				}
			}
			// A custom-typed value (allowCustomInput) is returned verbatim.
			return value;
		});
	}

	async inputPrompt(
		header: string,
		placeholder?: string,
		value?: string,
	): Promise<string> {
		return this.textPrompt(header, placeholder, value, false);
	}

	async wideInputPrompt(
		header: string,
		placeholder?: string,
		value?: string,
	): Promise<string> {
		return this.textPrompt(header, placeholder, value, true);
	}

	private async textPrompt(
		header: string,
		placeholder: string | undefined,
		value: string | undefined,
		multiline: boolean,
	): Promise<string> {
		const answer = await this.server.emitPrompt(this.sessionId, {
			type: "input",
			header,
			placeholder,
			defaultValue: value,
			multiline,
		});
		return answer == null ? "" : String(answer);
	}

	async datePrompt(
		header: string,
		options?: {
			placeholder?: string;
			defaultValue?: string;
			dateFormat?: string;
			withTime?: boolean;
		},
	): Promise<string> {
		const answer = await this.server.emitPrompt(this.sessionId, {
			type: "date",
			header,
			placeholder: options?.placeholder,
			defaultValue: options?.defaultValue,
			dateFormat: options?.dateFormat,
			withTime: options?.withTime,
		});
		const raw = String(answer ?? "");
		if (!raw) return "";
		// The client may send a bare ISO or an `@date:ISO`; normalize to the ISO.
		const iso = raw.startsWith("@date:") ? raw.slice(6) : raw;
		// Match QuickAddApi.datePrompt exactly: format with the requested format,
		// else return the full ISO string (not just its date part).
		const format = options?.dateFormat;
		const formatted = format ? formatISODate(iso, format) : null;
		return formatted ?? iso;
	}

	async yesNoPrompt(header: string, text?: string): Promise<boolean> {
		const answer = await this.server.emitPrompt(this.sessionId, {
			type: "confirm",
			header,
			text,
		});
		return answer === true || answer === "true";
	}

	async checkboxPrompt(
		items: string[],
		selectedItems?: string[],
		header?: string,
	): Promise<string[]> {
		const selected = new Set(selectedItems ?? []);
		const answer = await this.server.emitPrompt(this.sessionId, {
			type: "checkbox",
			header,
			items: items.map((value) => ({
				title: String(value),
				value: String(value),
				checked: selected.has(value),
			})),
		});
		return Array.isArray(answer) ? answer.map((v) => String(v)) : [];
	}

	async infoDialog(header: string, text: string[] | string): Promise<void> {
		await this.server.emitPrompt(this.sessionId, {
			type: "info",
			header,
			text: Array.isArray(text) ? text : [text],
		});
	}

	async requestInputs(
		fields: FieldRequirement[],
	): Promise<Record<string, string>> {
		const formFields: FormField[] = fields.map((field) => ({
			id: field.id,
			label: field.label ?? field.id,
			type: field.type === "file-picker" ? "suggester" : field.type,
			placeholder: field.placeholder,
			defaultValue: field.defaultValue,
			description: field.description,
			options: field.options,
			dateFormat: field.dateFormat,
			optional: field.optional,
			numericConfig: field.numericConfig,
			suggesterConfig: field.suggesterConfig
				? {
						allowCustomInput: field.suggesterConfig.allowCustomInput,
						multiSelect: field.suggesterConfig.multiSelect,
					}
				: undefined,
		}));

		const answer = await this.server.emitPrompt(this.sessionId, {
			type: "form",
			fields: formFields,
		});
		if (!answer || typeof answer !== "object") return {};
		// Date fields must come back as `@date:ISO`, matching OnePageInputModal, so
		// QuickAddApi.requestInputs' shared post-processing stores the raw ISO and
		// applies dateFormat identically to the in-app path.
		const dateFieldIds = new Set(
			fields.filter((field) => field.type === "date").map((field) => field.id),
		);
		const result: Record<string, string> = {};
		for (const [key, value] of Object.entries(answer as Record<string, unknown>)) {
			let str = value == null ? "" : String(value);
			if (str && dateFieldIds.has(key) && !str.startsWith("@date:")) {
				str = `@date:${str}`;
			}
			result[key] = str;
		}
		return result;
	}
}
