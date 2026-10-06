import type IChoice from "../types/choices/IChoice";
import { flattenChoices } from "../utils/choiceUtils";

/** The language of the fenced code block that renders QuickAdd buttons. */
export const BUTTON_BLOCK_LANGUAGE = "quickadd";

export type ButtonRef = { by: "name" | "id"; value: string };

/** One line of a button block: a choice and its label, or a line that names no choice. */
export type ButtonLine = { ref: ButtonRef; label: string | null } | { unreadable: string };

/**
 * A button block's body: one choice per line, by name (`Log`) or by id
 * (`id: <uuid>`), with an optional label after a pipe (`Log | Journal`).
 * Blank lines and lines starting with `#` are skipped.
 */
export function parseButtonBlock(source: string): ButtonLine[] {
	const lines: ButtonLine[] = [];
	for (const raw of source.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const pipe = line.indexOf("|");
		const ref = (pipe === -1 ? line : line.slice(0, pipe)).trim();
		const label = pipe === -1 ? null : line.slice(pipe + 1).trim() || null;
		const id = /^id:(.*)$/.exec(ref);
		const value = (id ? id[1] : ref).trim();
		lines.push(value ? { ref: { by: id ? "id" : "name", value }, label } : { unreadable: line });
	}
	return lines;
}

export type ButtonTarget = { choice: IChoice } | { problem: string };

/**
 * The choice a line points at. A name matches exactly, else ignoring case;
 * several matches are a problem, never a guess.
 */
export function resolveButtonRef(ref: ButtonRef, choices: IChoice[]): ButtonTarget {
	const all = flattenChoices(choices);
	if (ref.by === "id") {
		const choice = all.find((c) => c.id === ref.value);
		return choice ? { choice } : { problem: `No choice with id '${ref.value}'` };
	}
	const name = (c: IChoice) => (typeof c.name === "string" ? c.name.trim() : "");
	const exact = all.filter((c) => name(c) === ref.value);
	const matches = exact.length > 0 ? exact : all.filter((c) => name(c).toLowerCase() === ref.value.toLowerCase());
	if (matches.length === 1) return { choice: matches[0] };
	return { problem: matches.length === 0 ? `No choice named '${ref.value}'` : `Several choices named '${ref.value}'` };
}

/** A button block for `choice`: by its name when that finds it, else by its id. */
export function buttonBlockFor(choice: IChoice, choices: IChoice[]): string {
	const block = (body: string) => `\`\`\`${BUTTON_BLOCK_LANGUAGE}\n${body}\n\`\`\`\n`;
	const lines = parseButtonBlock(typeof choice.name === "string" ? choice.name : "");
	const line = lines.length === 1 ? lines[0] : undefined;
	if (line && "ref" in line && line.ref.by === "name" && line.label === null) {
		const target = resolveButtonRef(line.ref, choices);
		if ("choice" in target && target.choice.id === choice.id) return block(line.ref.value);
	}
	return block(`id: ${choice.id}`);
}
