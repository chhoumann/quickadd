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
import { interactivePromptServer } from "./interactivePromptServer";

export interface PromptProvider {
	suggester(
		displayItems:
			| string[]
			| ((value: string, index?: number, arr?: string[]) => string),
		actualItems: string[],
		placeholder?: string,
		allowCustomInput?: boolean,
	): Promise<string>;
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
		options?: { placeholder?: string; defaultValue?: string; dateFormat?: string },
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
	): Promise<string> {
		const displays =
			typeof displayItems === "function"
				? actualItems.map((value, index, arr) =>
						String(displayItems(value, index, arr)),
					)
				: displayItems.map((label) => String(label));

		const items = actualItems.map((value, index) => ({
			title: displays[index] ?? String(value),
			value: String(value),
		}));

		const answer = await this.server.emitPrompt(this.sessionId, {
			type: "suggester",
			placeholder,
			allowCustomInput,
			items,
		});
		return answer == null ? "" : String(answer);
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
		options?: { placeholder?: string; defaultValue?: string; dateFormat?: string },
	): Promise<string> {
		const answer = await this.server.emitPrompt(this.sessionId, {
			type: "date",
			header,
			placeholder: options?.placeholder,
			defaultValue: options?.defaultValue,
			dateFormat: options?.dateFormat,
		});
		const iso = String(answer ?? "");
		if (!iso) return "";
		// Match VDateInputPrompt's output: format the picked ISO date with the
		// requested format, falling back to the date part of the ISO string.
		const format = options?.dateFormat;
		const formatted = format ? formatISODate(iso, format) : null;
		return formatted ?? (iso.length >= 10 ? iso.slice(0, 10) : iso);
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
}
