/**
 * Strict reply contract for a prompt an engine opens over the interactive
 * bridge. The script-facing suggester turns a missing value into `""` and passes
 * any string through. For an engine picker `""` is not an answer (the folder
 * chooser would write to the vault root), and a closed list must not widen into
 * free text, so a reply the in-app modal could not have produced ends the run.
 */

import { UserCancelError } from "../errors/UserCancelError";
import type { PromptProvider } from "./promptProvider";

/**
 * Prefix for this module's own row handles. The NUL char makes a collision with a
 * value a user could type effectively impossible, mirroring the provider's own
 * index token.
 */
const HANDLE_PREFIX = "\u0000qa-eng:";

interface EngineChoiceItem<T> {
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
	// Our own handles, not the real values: a folder list can contain "" (the
	// vault root), and the provider decodes its index token to the raw value, so
	// picking that row and answering nothing would both arrive as "".
	const handles = spec.items.map((_, index) => `${HANDLE_PREFIX}${index}`);
	const answer = await provider.suggester(
		spec.items.map((item) => item.title),
		handles,
		spec.placeholder,
		spec.allowCustomInput ?? false,
	);

	const text = answer == null ? "" : String(answer);

	const picked = handles.indexOf(text);
	if (picked !== -1) return spec.items[picked].value;

	// Not a handle, so the client either typed something or answered nothing. An
	// empty reply is what `suggester` produces for a missing value; a client that
	// means to cancel sends `{"cancelled": true}`, which rejects before we get here.
	if (text === "") throw new UserCancelError("Input cancelled by user");

	if (spec.allowCustomInput) return text;

	throw new Error(
		`A reply to ${spec.what} has to be one of the offered options, and "${text.slice(0, 60)}" is not. ` +
			`Reply with the item's \`value\` token exactly as it was sent, or \`{"cancelled": true}\` to dismiss it.`,
	);
}
