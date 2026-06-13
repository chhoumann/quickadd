export interface ScriptExtractionResult {
	/**
	 * The runnable JavaScript body, or `null` when the note has no JS fence.
	 *
	 * On success the body is prefixed with one blank line per source line that
	 * precedes the fence body. This shifts runtime stack-trace line numbers to
	 * roughly the note's own line numbers (so an error points near the right line
	 * when editing the script in Obsidian) — it removes the prose/frontmatter
	 * offset, modulo the small constant the `new Function` wrapper adds. The
	 * original line endings inside the body are preserved byte-for-byte.
	 *
	 * An empty/whitespace-only fence resolves to `""` (with `error` set) so callers
	 * can reject it with the same `code` falsiness check as the no-fence case.
	 */
	code: string | null;
	/** Human-readable reason, set whenever `code` is `null` or empty. */
	error?: string;
}

// A fenced-code line: up to 3 leading spaces (CommonMark), then >=3 backticks,
// then the info string. Spaces only — tabs/blockquote(`>`)/callout prefixes are
// intentionally NOT treated as fences (documented as out of scope for v1).
const FENCE_LINE = /^ {0,3}(`{3,})(.*)$/;

const NO_FENCE_ERROR =
	"No ```js (or ```javascript) code block found in the note.";
const EMPTY_FENCE_ERROR = "The ```js code block is empty.";

/**
 * Extract the script body from a markdown note for use as a QuickAdd user script.
 *
 * Selection rule (v1): run the FIRST ```js / ```javascript fenced block; prose and
 * any other blocks are ignored ("one note = one script"). The info string is
 * matched on its first whitespace-delimited token (case-insensitive), so
 * ```js, ```javascript, and ```js extra all qualify while ```jsx / ```json do not.
 *
 * Fence rules follow CommonMark: the block closes at the first line that is a bare
 * run of >= the opening backtick count with nothing but whitespace after it. A line
 * with trailing content (e.g. `console.log("```")`) therefore does NOT close the
 * block; a bare ``` line inside a template literal WILL — wrap the body in 4+
 * backticks to embed a 3-backtick line.
 *
 * Pure and App-free: safe to call from the package-preview module and from unit
 * tests under jsdom.
 */
export function extractScriptFromMarkdown(
	content: string,
): ScriptExtractionResult {
	let pos = 0;
	let lineIndex = 0;
	let inFence = false;
	let openLen = 0;
	let bodyStartOffset = 0;
	let linesBeforeBody = 0;

	while (pos <= content.length) {
		const nl = content.indexOf("\n", pos);
		const lineEnd = nl === -1 ? content.length : nl;
		const lineText = content.slice(pos, lineEnd).replace(/\r$/, "");
		const nextPos = nl === -1 ? content.length + 1 : nl + 1;

		const match = FENCE_LINE.exec(lineText);

		if (!inFence) {
			if (match) {
				const firstToken = match[2].trim().split(/\s+/)[0]?.toLowerCase();
				if (firstToken === "js" || firstToken === "javascript") {
					inFence = true;
					openLen = match[1].length;
					bodyStartOffset = nextPos;
					linesBeforeBody = lineIndex + 1;
				}
			}
		} else if (
			match &&
			match[1].length >= openLen &&
			match[2].trim().length === 0
		) {
			return finish(content.slice(bodyStartOffset, pos), linesBeforeBody);
		}

		pos = nextPos;
		lineIndex++;
		if (nl === -1) break;
	}

	if (inFence) {
		// Unclosed fence: treat the remainder of the note as the body.
		return finish(content.slice(bodyStartOffset), linesBeforeBody);
	}

	return { code: null, error: NO_FENCE_ERROR };
}

function finish(body: string, linesBeforeBody: number): ScriptExtractionResult {
	if (body.trim().length === 0) {
		return { code: "", error: EMPTY_FENCE_ERROR };
	}
	return { code: "\n".repeat(linesBeforeBody) + body };
}
