import type IChoice from "src/types/choices/IChoice";
import type IMultiChoice from "src/types/choices/IMultiChoice";

/**
 * The shapes `data.json` actually shows up in when it has been hand-edited,
 * imported, half-written or merged by a sync that does not understand JSON.
 * Shared by every resilience test so they all attack the same tree, and so a new
 * shape is added in exactly one place. See #1566.
 */

export function leaf(name: string, id: string): IChoice {
	return { id, name, type: "Template", command: false } as IChoice;
}

export function folder(name: string, id: string, children: IChoice[]): IChoice {
	return {
		id,
		name,
		type: "Multi",
		command: false,
		collapsed: false,
		choices: children,
	} as IMultiChoice;
}

/** A Multi whose `choices` is whatever `children` is, however wrong that is. */
export function malformedFolder(
	name: string,
	id: string,
	children: unknown,
): IChoice {
	const node: Record<string, unknown> = {
		id,
		name,
		type: "Multi",
		command: false,
		collapsed: false,
	};
	// `undefined` must leave the key ABSENT, not present-and-undefined: that is
	// the shape a deleted key has, and JSON.stringify would otherwise hide the
	// difference in the preservation assertions.
	if (children !== undefined) node.choices = children;
	return node as unknown as IChoice;
}

export const MALFORMED_CHILDREN_SHAPES: {
	key: string;
	value: unknown;
	/** Whether the value could still be holding choices we cannot read. */
	lossy: boolean;
}[] = [
	{ key: "missing", value: undefined, lossy: false },
	{ key: "null", value: null, lossy: false },
	{ key: "emptyObject", value: {}, lossy: false },
	// Falsy primitives carry nothing, exactly like `null` - #1611, where the
	// predicate's `: true` arm contradicted its own doc and reported them lossy.
	{ key: "emptyString", value: "", lossy: false },
	{ key: "zero", value: 0, lossy: false },
	{ key: "false", value: false, lossy: false },
	{ key: "arrayLikeObject", value: { "0": leaf("Hidden", "hidden-1") }, lossy: true },
	{ key: "string", value: "not a list", lossy: true },
	{ key: "number", value: 7, lossy: true },
];

/**
 * The same question for `macro.commands`, which has exactly the same problem
 * (#1593): declared `ICommand[]`, read straight out of an untrusted data.json.
 * Kept as its own list because a command list has two failure modes a choice
 * list does not - it is also reachable as a conditional's `thenCommands` /
 * `elseCommands`, and a perfectly good ARRAY can still be unrenderable.
 */
export const MALFORMED_COMMANDS_SHAPES: {
	key: string;
	value: unknown;
	/** Whether the value could still be holding commands we cannot read. */
	lossy: boolean;
}[] = [
	{ key: "missing", value: undefined, lossy: false },
	{ key: "null", value: null, lossy: false },
	{ key: "emptyObject", value: {}, lossy: false },
	{ key: "emptyString", value: "", lossy: false },
	{ key: "zero", value: 0, lossy: false },
	{ key: "false", value: false, lossy: false },
	{ key: "arrayLikeObject", value: { "0": waitCommand("hidden-cmd") }, lossy: true },
	{ key: "string", value: "not a list", lossy: true },
	{ key: "number", value: 7, lossy: true },
];

export function waitCommand(id: string, name = "Wait"): unknown {
	return { id, name, type: "Wait", time: 100 };
}

/**
 * A Macro choice whose `macro.commands` is whatever `commands` is, however wrong
 * that is. `macro` itself is untrusted too, so passing `macro: null` builds a
 * choice with no macro object at all - the shape that used to make "Configure"
 * do nothing whatsoever.
 */
export function macroChoice(
	name: string,
	id: string,
	commands: unknown,
	options: { noMacro?: boolean } = {},
): IChoice {
	const node: Record<string, unknown> = {
		id,
		name,
		type: "Macro",
		command: false,
		runOnStartup: false,
	};
	if (options.noMacro) {
		node.macro = null;
		return node as unknown as IChoice;
	}
	const macro: Record<string, unknown> = { id: `${id}-macro`, name };
	// `undefined` must leave the key ABSENT (same reasoning as malformedFolder).
	if (commands !== undefined) macro.commands = commands;
	node.macro = macro;
	return node as unknown as IChoice;
}

/** A Conditional command whose branches are whatever they are handed. */
export function conditionalCommand(
	id: string,
	thenCommands: unknown,
	elseCommands: unknown,
): unknown {
	return {
		id,
		name: "If",
		type: "Conditional",
		condition: {
			mode: "variable",
			variableName: "x",
			operator: "isTruthy",
			valueType: "string",
		},
		thenCommands,
		elseCommands,
	};
}

/**
 * One tree carrying every malformed shape plus healthy neighbours on both sides,
 * so a walker that dies partway through is caught by a missing TAIL choice and
 * not just by the throw.
 *
 * Corruption is placed at EVERY depth, not just the root. A first version of
 * this fixture only had malformed folders at the top level, and a walker that
 * guards its entry point but not its recursion passes that happily - which is
 * exactly the bug being fixed, one level down.
 */
export function malformedTree(): IChoice[] {
	const broken = (suffix = "") =>
		MALFORMED_CHILDREN_SHAPES.map((shape) =>
			malformedFolder(
				`Broken ${shape.key}${suffix}`,
				`broken-${shape.key}${suffix}`,
				shape.value,
			),
		);

	// The same, for macros. Every shape appears at every depth for the same
	// reason the folder shapes do: a walker that guards `macro.commands` at its
	// entry point but not inside a conditional's branches passes the top-level
	// cases happily.
	const brokenMacros = (suffix = "") => [
		...MALFORMED_COMMANDS_SHAPES.map((shape) =>
			macroChoice(
				`Broken macro ${shape.key}${suffix}`,
				`broken-macro-${shape.key}${suffix}`,
				shape.value,
			),
		),
		// A macro object that is missing entirely.
		macroChoice(`No macro${suffix}`, `no-macro${suffix}`, undefined, {
			noMacro: true,
		}),
		// A readable ARRAY that is still unrenderable: a hole, an id-less command
		// and two commands sharing an id. Nothing here may be dropped or rewritten
		// by a walker that is only passing through.
		macroChoice(`Unkeyable macro${suffix}`, `unkeyable-macro${suffix}`, [
			waitCommand("dup-cmd", "First"),
			waitCommand("dup-cmd", "Second"),
			{ name: "No id", type: "Wait", time: 1 },
			null,
			"stray",
		]),
		// Corruption inside a conditional's branches - one level below every guard
		// that only looks at `macro.commands`.
		macroChoice(`Conditional macro${suffix}`, `conditional-macro${suffix}`, [
			conditionalCommand(
				`cond-both${suffix}`,
				{ "0": waitCommand(`hidden-then${suffix}`) },
				"not a list",
			),
			conditionalCommand(`cond-holes${suffix}`, [null, waitCommand(`t${suffix}`)], [
				waitCommand(`dup-branch${suffix}`),
				waitCommand(`dup-branch${suffix}`),
			]),
		]),
	];

	return [
		leaf("Head template", "head"),
		folder("Healthy folder", "healthy", [leaf("Child note", "child")]),
		// A healthy folder is not a safe branch: its children can carry the same
		// corruption, including a hole in ITS list.
		folder("Nesting folder", "nesting", [
			leaf("Nested note", "nested-note"),
			...broken("-nested"),
			...brokenMacros("-nested"),
			null as unknown as IChoice,
			folder("Deep folder", "deep", [
				leaf("Deep note", "deep-note"),
				...broken("-deep"),
				...brokenMacros("-deep"),
			]),
		]),
		...broken(),
		...brokenMacros(),
		// A healthy macro, so a walker that skips the type entirely is caught too.
		macroChoice("Healthy macro", "healthy-macro", [waitCommand("healthy-cmd")]),
		// A hole in the list itself: `null` survives a truncated write, and it used
		// to throw inside dedupeChoicesById during loadSettings.
		null as unknown as IChoice,
		"stray" as unknown as IChoice,
		leaf("Tail template", "tail"),
	];
}

/** The ids of the choices in `malformedTree()` that are perfectly well-formed. */
export const HEALTHY_IDS = [
	"head",
	"healthy",
	"child",
	"nesting",
	"nested-note",
	"deep",
	"deep-note",
	"healthy-macro",
	"tail",
];

/**
 * Every unreadable `choices` / `macro.commands` / branch value still in the
 * tree, keyed by the node that owns it, as a comparable string. This is what the
 * preservation assertions compare: an edit elsewhere in the tree must not
 * rewrite, drop, or "repair" any of them.
 *
 * List holes (`null`, a stray primitive) are deliberately NOT tracked. They hold
 * nothing recoverable, so a walker is free to step over one or drop it; only a
 * container's value can be hiding real choices or commands.
 *
 * Command IDS are not tracked either, for the same reason at one remove: the
 * macro EDITOR is allowed to re-key an unkeyable command (see
 * normalizeCommandList), and pinning ids here would forbid the very repair
 * #1593 added. What is pinned is that no walker LOSES a command.
 */
export function malformedSnapshot(choices: IChoice[]): string {
	const seen: unknown[] = [];

	const walkCommands = (owner: string, list: unknown) => {
		if (!Array.isArray(list)) {
			seen.push([owner, "commands", list]);
			return;
		}
		// Arity is the invariant for a readable list: a walker may re-key an entry
		// but must never drop one.
		seen.push([owner, "commandCount", list.length]);
		list.forEach((command, index) => {
			if (typeof command !== "object" || command === null) return;
			const node = command as Record<string, unknown>;
			if (node.type !== "Conditional") return;
			walkCommands(`${owner}/${index}/then`, node.thenCommands);
			walkCommands(`${owner}/${index}/else`, node.elseCommands);
		});
	};

	const walk = (list: unknown) => {
		if (!Array.isArray(list)) return;
		for (const entry of list) {
			if (typeof entry !== "object" || entry === null) continue;
			const node = entry as Record<string, unknown>;
			if (node.type === "Macro") {
				const macro = node.macro;
				if (typeof macro !== "object" || macro === null) {
					seen.push([node.id, "macro", macro]);
					continue;
				}
				const macroNode = macro as Record<string, unknown>;
				if ("commands" in macroNode) {
					walkCommands(String(node.id), macroNode.commands);
				} else {
					seen.push([node.id, "commandsAbsent"]);
				}
				continue;
			}
			if (node.type !== "Multi") continue;
			if (Array.isArray(node.choices)) {
				walk(node.choices);
			} else {
				seen.push([node.id, "choices" in node, node.choices]);
			}
		}
	};
	walk(choices);
	return JSON.stringify(seen);
}

