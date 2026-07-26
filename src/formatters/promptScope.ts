import { NAME_VALUE_REGEX } from "../constants";

/**
 * What the string currently being formatted will BECOME once the user answers.
 *
 * A runtime prompt is a question with no question text: the modal shows the
 * choice's name and an empty box, so a Template's title prompt and a Capture's
 * text prompt are indistinguishable (issue #1546). The scope is what lets a
 * prompt say what it is asking for.
 *
 * The scope is DECLARED by the caller, never inferred from which `format*`
 * method ran: `formatFileContent` is shared by template bodies, capture bodies,
 * `quickAddApi.format` and the AI agent, so a capture-specific label derived
 * from the method would be a lie in three of those four cases.
 */
export type PromptScopeKind =
	| "noteTitle"
	| "captureTarget"
	| "captureText"
	| "noteBody"
	| "folder"
	| "templatePath"
	| "lineTarget"
	| "filePath"
	| "generic";

/**
 * Where the answer to a prompt ends up, when the engine already knows it.
 * `destination` is a vault-relative path; `destinationKind` says whether it
 * names a file or the folder a file is about to be created in.
 */
export interface PromptRunContext {
	choiceName?: string;
	/**
	 * Identity of the PROMPT SITE for input-draft keys. Usually the choice id,
	 * but an included `{{TEMPLATE:...}}` renders through its own formatter and
	 * raises its own `{{VALUE}}` prompt, so it must not share the parent's key -
	 * otherwise the second prompt of one run opens pre-filled with the first's
	 * answer. Must be stable ACROSS runs (draft recovery after a cancel depends
	 * on it), so it can never be a per-run value such as a fresh uuid.
	 */
	draftScopeId?: string;
	destination?: string;
	destinationKind?: "file" | "folder";
}

interface ScopeCopy {
	/**
	 * Modal title, used ONLY when the answer is provably the whole of what the
	 * scope names (see {@link valueAnswersWholeScope}).
	 */
	ask: string;
	/** Input placeholder for that same whole-answer case. */
	hint: string;
	/**
	 * Input placeholder when the answer is only part of the result. Phrased so it
	 * stays true for e.g. a file name format of `{{DATE:YYYY-MM-DD}} {{VALUE}}`,
	 * where a title of "Note title" would invite the user to retype the date.
	 */
	partOf: string;
}

/**
 * Scopes whose surrounding literal text is CONTENT FORMATTING rather than part
 * of the answer. A capture format is a one-line template: `- [ ] {{VALUE}}`
 * still asks for exactly "the text to capture", because the checkbox prefix is
 * decoration nobody types.
 *
 * Everything else uses the strict rule. A PATH's literals are part of the
 * answer (`Daily/{{VALUE}}.md`), and so, in practice, are a template BODY's:
 * a body of "---\nclient: {{VALUE}}\n---\n# Onboarding" has exactly one token
 * but is asking for a client name, not for the note's content.
 */
const FORMATTING_LITERAL_SCOPES: ReadonlySet<PromptScopeKind> = new Set([
	"captureText",
]);

const SCOPE_COPY: Record<Exclude<PromptScopeKind, "generic">, ScopeCopy> = {
	noteTitle: {
		ask: "Note title",
		hint: "Title for the new note",
		partOf: "Part of the new note's title",
	},
	captureTarget: {
		// "Capture to" also accepts `property:`, `#tag` and `folder:` filters that
		// drive a note picker, so the copy deliberately says "destination" rather
		// than "path" or "note".
		ask: "Capture target",
		hint: "Where to capture to",
		partOf: "Part of the capture destination",
	},
	captureText: {
		ask: "Text to capture",
		hint: "Text to add to the note",
		partOf: "Part of the text added to the note",
	},
	noteBody: {
		ask: "Note content",
		hint: "Text inserted into the note",
		partOf: "Part of the text inserted into the note",
	},
	folder: {
		ask: "Folder",
		hint: "Folder for the new note",
		partOf: "Part of the folder path",
	},
	templatePath: {
		ask: "Template",
		hint: "Path to the template file",
		partOf: "Part of the template path",
	},
	lineTarget: {
		// The answer is an ANCHOR that is searched for, not the text that gets
		// written, so both strings say "find" (and neither promises where exactly
		// the capture lands, which depends on insert-before / insert-at-end).
		ask: "Line to find",
		hint: "Existing line to anchor the capture to",
		partOf: "Part of the line to find",
	},
	filePath: {
		ask: "File to open",
		hint: "Path to the file to open",
		partOf: "Part of the file path",
	},
};

// Anchored copy of NAME_VALUE_REGEX: `{{VALUE}}` / `{{NAME}}` with optional
// `|options`, and nothing else. Built from the shared source so the two can
// never drift.
const SOLE_VALUE_TOKEN_REGEX = new RegExp(
	`^(?:${NAME_VALUE_REGEX.source})$`,
	"i",
);

// Any remaining `{{...}}` token once the anonymous VALUE tokens are removed.
const ANONYMOUS_VALUE_TOKEN_REGEX = new RegExp(NAME_VALUE_REGEX.source, "gi");
const ANY_TOKEN_REGEX = /\{\{[^}\n\r]*\}\}/;

/**
 * True when the string being formatted is nothing but one anonymous
 * `{{VALUE}}`/`{{NAME}}` token, i.e. the user's answer becomes the entire
 * result verbatim.
 */
export function isSoleValueToken(input: string): boolean {
	return SOLE_VALUE_TOKEN_REGEX.test(input.trim());
}

/**
 * True when the anonymous `{{VALUE}}` is the only TOKEN in the string, i.e. the
 * user's answer is the only thing the result varies by. Literal text may
 * surround it.
 */
export function isOnlyValueToken(input: string): boolean {
	const withoutValue = input.replace(ANONYMOUS_VALUE_TOKEN_REGEX, "");
	if (withoutValue === input) return false;
	return !ANY_TOKEN_REGEX.test(withoutValue);
}

/**
 * Whether a prompt for the anonymous `{{VALUE}}` may claim to be asking for the
 * whole of what its scope names. Paths demand the strict rule (their literals
 * are part of the answer's meaning); content scopes tolerate literal decoration.
 */
export function valueAnswersWholeScope(
	scope: PromptScopeKind,
	input: string,
): boolean {
	return FORMATTING_LITERAL_SCOPES.has(scope)
		? isOnlyValueToken(input)
		: isSoleValueToken(input);
}

/**
 * Whether a scope names a PATH. The preflight collector still needs the plain
 * path/content boolean (it gates image paste and the template-scan memo key),
 * so the two stay derived from one place.
 */
export function isPathScope(scope: PromptScopeKind): boolean {
	return (
		scope === "noteTitle" ||
		scope === "captureTarget" ||
		scope === "folder" ||
		scope === "templatePath" ||
		scope === "lineTarget" ||
		scope === "filePath"
	);
}

/**
 * Whether the context line may name a destination for this scope. A prompt
 * inside a template SOURCE path chooses which template file to READ, so the
 * note being written is not where that answer lands; `generic` knows nothing.
 */
export function scopeShowsDestination(scope: PromptScopeKind): boolean {
	return scope !== "templatePath" && scope !== "generic";
}

export interface ValuePromptCopy {
	/** Modal title, or undefined to keep the caller's fallback. */
	title?: string;
	/** Input placeholder, or undefined for none. */
	placeholder?: string;
}

/**
 * Copy for the anonymous `{{VALUE}}` prompt. Named tokens ({{VALUE:x}},
 * {{FIELD:}}, {{VDATE:}}) already title themselves with their own name and are
 * deliberately untouched.
 */
export function describeValuePrompt(
	scope: PromptScopeKind,
	soleValue: boolean,
): ValuePromptCopy {
	if (scope === "generic") return {};
	const copy = SCOPE_COPY[scope];
	return soleValue
		? { title: copy.ask, placeholder: copy.hint }
		: { placeholder: copy.partOf };
}

const ELIDE_MARKER = "…";

/**
 * Shortens a vault path for the one-line context bar by eliding the MIDDLE
 * folders, so the file name (the part that identifies the destination) always
 * survives. CSS end-ellipsis would truncate exactly the useful half.
 */
export function elideMiddlePath(path: string, maxLength = 44): string {
	if (path.length <= maxLength) return path;

	const segments = path.split("/");
	// Nothing to elide: a single over-long segment IS the file name, and mangling
	// it would make it read as a different file.
	if (segments.length === 1) return path;

	const last = segments[segments.length - 1];
	// One folder: dropping it is the only elision available, and the file name is
	// the half worth keeping.
	if (segments.length === 2) {
		const elided = `${ELIDE_MARKER}/${last}`;
		return elided.length < path.length ? elided : path;
	}

	const first = segments[0];
	const elided = `${first}/${ELIDE_MARKER}/${last}`;
	// Dropping every middle folder is the shortest form this can take; if even
	// that overflows, the CSS ellipsis handles the rest rather than mangling the
	// name into something that looks like a different file.
	return elided.length < path.length ? elided : path;
}

/**
 * The muted line under the modal title: which choice is asking, and where the
 * answer lands. Returns undefined when there is nothing true to say, and omits
 * the choice name when it is already the title (so it is never printed twice).
 */
export function buildPromptContextLine(
	context: PromptRunContext | undefined,
	title: string | undefined,
	options?: { elide?: boolean; showDestination?: boolean },
): string | undefined {
	if (!context) return undefined;

	const parts: string[] = [];
	const name = context.choiceName?.trim();
	// Omitted when it is already the title, so the name is never printed twice.
	if (name && name !== title?.trim()) parts.push(name);

	const destination =
		options?.showDestination === false ? undefined : context.destination?.trim();
	if (destination) {
		const shown =
			options?.elide === false ? destination : elideMiddlePath(destination);
		parts.push(
			`→ ${context.destinationKind === "folder" ? `${shown}/` : shown}`,
		);
	}

	return parts.length ? parts.join(" ") : undefined;
}
