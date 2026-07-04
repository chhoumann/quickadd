/**
 * Abstraction the QuickAdd API prompt methods consult before opening an Obsidian
 * modal. When a choice executor carries a provider (a remote interactive session
 * driven by an external front end), prompts are routed to it instead of the app.
 *
 * Spike scope: `suggester`. The interface will grow to cover the rest of the
 * prompt seam (inputPrompt / yesNoPrompt / checkboxPrompt / ...) as they are
 * forwarded.
 */

import { interactivePromptServer } from "./interactivePromptServer";

export interface PromptProvider {
	suggester(
		displayItems: string[] | ((value: string, index?: number, arr?: string[]) => string),
		actualItems: string[],
		placeholder?: string,
		allowCustomInput?: boolean,
	): Promise<string>;
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

		// A rejected reply (cancel) throws upstream in emitPrompt; here `answer` is
		// the chosen item's value, or free text when allowCustomInput is set.
		return answer == null ? "" : String(answer);
	}
}
