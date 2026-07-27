/**
 * The strict reply contract for a prompt an ENGINE opens over the interactive bridge.
 *
 * `RemotePromptProvider.suggester` is tuned for the callers it was written for — scripts
 * and the formatter — and is lenient in two ways that are correct there and wrong here:
 *
 * 1. A missing/`null` value becomes `""` (promptProvider.ts). For a script's optional
 *    suggester that is a real answer ("skipped"). For an engine picker it is not an
 *    answer at all, and `""` is actively dangerous: it reaches
 *    `getFileExistsMode("")`, which throws the internal `Unknown file exists mode: `,
 *    and it makes the folder chooser resolve to the empty path — creating the note in
 *    the VAULT ROOT, where dismissing the same modal in Obsidian would have cancelled
 *    the run.
 * 2. Any non-token string comes back verbatim, whether or not the site allows custom
 *    input. In Obsidian that cannot happen: `GenericSuggester` can only ever resolve an
 *    element of its list. Routing the prompt must not quietly widen a closed list into
 *    free text just because the answer now arrives over HTTP.
 *
 * So engine prompts validate what comes back against the list they offered. A reply that
 * the in-app modal could not have produced ends the run with a message naming the fix,
 * instead of being acted on. The lenient path is left exactly as it is for the script and
 * formatter callers that depend on it.
 */

import { UserCancelError } from "../errors/UserCancelError";
import type { PromptProvider } from "./promptProvider";

export interface EngineChoiceItem<T> {
	/** The real item. Never crosses the wire — the provider tokenises by index. */
	value: T;
	/** What the client shows. Must be a human label, not a fuzzy-search blob. */
	title: string;
}

/**
 * Ask the connected client to pick from a list the engine controls.
 *
 * Returns one of the `items` values, or — only when `allowCustomInput` is set — the
 * client's own string. Throws {@link UserCancelError} when the client answers nothing,
 * matching what dismissing the equivalent Obsidian modal does.
 */
export async function promptEngineChoice<T>(
	provider: PromptProvider,
	spec: {
		items: EngineChoiceItem<T>[];
		placeholder?: string;
		allowCustomInput?: boolean;
		/** Names the picker in the protocol error, e.g. `the "file already exists" chooser`. */
		what: string;
	},
): Promise<T | string> {
	const values = spec.items.map((item) => item.value);
	const answer = await provider.suggester(
		spec.items.map((item) => item.title),
		// The provider tokenises by index and hands back the ORIGINAL entry, so object
		// identity survives even though only titles are sent.
		values as unknown as string[],
		spec.placeholder,
		spec.allowCustomInput ?? false,
	);

	if (values.includes(answer as T)) return answer as T;

	const text = answer == null ? "" : String(answer);
	// An empty reply is the shape `suggester` produces for a missing value, and no
	// engine picker offers an empty row. Treat it as the dismissal it almost certainly
	// is rather than acting on it — a client that means to cancel has
	// `{"cancelled": true}`, which has already rejected before we get here.
	if (text === "") throw new UserCancelError("Input cancelled by user");

	if (spec.allowCustomInput) return text;

	throw new Error(
		`A reply to ${spec.what} has to be one of the offered options, and "${text.slice(0, 60)}" is not. ` +
			`Reply with the item's \`value\` token exactly as it was sent, or \`{"cancelled": true}\` to dismiss it.`,
	);
}
