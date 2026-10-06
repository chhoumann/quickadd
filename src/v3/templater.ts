/** A question Templater asks when it runs a template, as the template's text says. */
export interface TemplaterPrompt {
	label: string;
	kind: "prompt" | "suggester";
}

/** Whether `text` holds a Templater tag, which Templater runs once the note exists. */
export function usesTemplater(text: string): boolean {
	return text.includes("<%");
}

const TAG = /<%([\s\S]*?)%>/g;
const CALL = /\btp\s*\.\s*system\s*\.\s*(prompt|suggester)\s*\(/g;

/**
 * The `tp.system.prompt` and `tp.system.suggester` calls in `text`'s Templater
 * tags, in order. A prompt is labelled by its first argument when that is a
 * string; a suggester by its options when they are a list of strings, else as
 * "a choice", since its options are only known when it runs.
 */
export function templaterPrompts(text: string): TemplaterPrompt[] {
	const prompts: TemplaterPrompt[] = [];
	for (const [, code] of text.matchAll(TAG)) {
		for (const call of code.matchAll(CALL)) {
			const kind = call[1] as TemplaterPrompt["kind"];
			const rest = code.slice((call.index ?? 0) + call[0].length);
			const label = kind === "prompt" ? (readString(rest)?.value ?? "a value") : (readStrings(rest) ?? "a choice");
			prompts.push({ label, kind });
		}
	}
	return prompts;
}

/** The string literal `code` starts with, after whitespace, and the code after it. */
function readString(code: string): { value: string; rest: string } | null {
	const match = /^\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/.exec(code);
	if (!match || (match[1] === "`" && match[2].includes("${"))) return null;
	return { value: match[2].replace(/\\(.)/g, "$1"), rest: code.slice(match[0].length) };
}

/** The literal array of strings `code` starts with, joined, or null when it is anything else. */
function readStrings(code: string): string | null {
	let rest = code.replace(/^\s*\[/, "");
	if (rest === code) return null;
	const values: string[] = [];
	while (!/^\s*\]/.test(rest)) {
		const item = readString(rest);
		if (!item) return null;
		values.push(item.value);
		rest = item.rest.replace(/^\s*,/, "");
	}
	return values.length > 0 ? values.join(", ") : null;
}
