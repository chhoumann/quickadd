import type IChoice from "src/types/choices/IChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { ICommand } from "src/types/macros/ICommand";
import { walkAllCommandsInSettings } from "src/migrations/helpers/choice-traversal";
import type { AIProvider, ModelRef } from "./Provider";

type AICommandish = ICommand & {
	model?: string;
	modelRef?: ModelRef;
};

function isAICommand(command: ICommand): command is AICommandish {
	return (
		command.type === CommandType.AIAssistant ||
		command.type === CommandType.InfiniteAIAssistant
	);
}

/**
 * Pin every AI command in `choices` whose bare model name is not yet (validly)
 * pinned to the provider the pre-#1495 first-match rule resolves it to TODAY —
 * behavior-preserving by construction. Used by the one-time pinAiModelRefs
 * migration AND by package import, which can introduce bare-name commands
 * long after the migration ran. A ref that no longer matches the legacy
 * string is stale and gets re-pinned from the string. "Ask me" and names no
 * configured provider serves are left unpinned. Returns how many commands
 * were pinned; mutates in place.
 */
export function pinAiCommandModelRefs(
	choices: IChoice[],
	providers: AIProvider[],
	onPin?: (command: AICommandish, ref: ModelRef) => void,
): number {
	let pinned = 0;

	walkAllCommandsInSettings({ choices }, (command) => {
		if (!isAICommand(command)) return;
		// Preserve an existing ref only when it is VALID here: it matches the
		// legacy string AND its provider exists in THIS provider set and serves
		// the model. An imported ref from another vault (or one whose provider
		// was deleted) is dangling — left alone it would warn on every run and
		// still reroute by first-match, so it adopts this vault's current
		// first-match pin like any bare name.
		if (command.modelRef && command.modelRef.name === command.model) {
			const pinnedProvider = providers.find(
				(p) => p.id === command.modelRef?.providerId,
			);
			if (pinnedProvider?.models.some((m) => m.name === command.model)) {
				return;
			}
		}
		if (!command.model || command.model === "Ask me") return;

		// The pre-#1495 rule, verbatim: FIRST provider (in settings order)
		// listing the name.
		const provider = providers.find((p) =>
			p.models.some((m) => m.name === command.model),
		);
		if (!provider?.id) return;

		const ref: ModelRef = { providerId: provider.id, name: command.model };
		command.modelRef = ref;
		pinned++;
		onPin?.(command, ref);
	});

	return pinned;
}
