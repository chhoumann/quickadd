import { log } from "src/logger/logManager";
import type { QATool, ToolSet } from "../aiToolTypes";

export type ToolSetMap = ToolSet;

/** Per-group factory options for the built-in tool groups. */
export interface BuiltinGroupOptions {
	/** Keep only these tool names from the group. */
	only?: string[];
	/** Drop these tool names from the group. */
	exclude?: string[];
	/** Prefix the tool NAMES (the map keys) to avoid collisions. Never alters approval. */
	prefix?: string;
	/** Confine vault paths the group may read/write to these folders. */
	allowedRoots?: string[];
}

/**
 * Apply only/exclude/prefix to a built tool map. The prefix changes the map KEY
 * (the wire tool name) only — it never strips a tool's needsApproval/readOnly floor.
 */
export function applyGroupOptions(
	tools: ToolSetMap,
	options: BuiltinGroupOptions,
): ToolSetMap {
	let entries = Object.entries(tools);
	const known = new Set(entries.map(([name]) => name));
	warnUnknownNames(options.only, known, "only");
	warnUnknownNames(options.exclude, known, "exclude");
	if (options.only) {
		const allow = new Set(options.only);
		entries = entries.filter(([name]) => allow.has(name));
	}
	if (options.exclude) {
		const deny = new Set(options.exclude);
		entries = entries.filter(([name]) => !deny.has(name));
	}
	const prefix = options.prefix ?? "";
	return Object.fromEntries(
		entries.map(([name, t]) => [prefix + name, t]),
	) as ToolSetMap;
}

export function defineTool(def: Omit<QATool, "__qaTool">): QATool {
	return { ...def, __qaTool: true };
}

/**
 * Warn when an only/exclude entry matches no tool in the group — a typo such as
 * only:['read_notes'] (correct: 'read_note') otherwise silently yields an empty (or
 * unfiltered) tool map with no signal to debug against.
 */
function warnUnknownNames(
	names: string[] | undefined,
	known: Set<string>,
	option: "only" | "exclude",
): void {
	if (!names) return;
	const unknown = names.filter((name) => !known.has(name));
	if (unknown.length === 0) return;
	log.logWarning(
		`AI tools: ${option} listed unknown tool name(s) ${unknown
			.map((n) => `"${n}"`)
			.join(", ")}. Valid names: ${[...known].join(", ")}.`,
	);
}
