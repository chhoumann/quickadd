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
	{ key: "arrayLikeObject", value: { "0": leaf("Hidden", "hidden-1") }, lossy: true },
	{ key: "string", value: "not a list", lossy: true },
	{ key: "number", value: 7, lossy: true },
];

/**
 * One tree carrying every malformed shape plus healthy neighbours on both sides,
 * so a walker that dies partway through is caught by a missing TAIL choice and
 * not just by the throw.
 */
export function malformedTree(): IChoice[] {
	return [
		leaf("Head template", "head"),
		folder("Healthy folder", "healthy", [leaf("Child note", "child")]),
		...MALFORMED_CHILDREN_SHAPES.map((shape) =>
			malformedFolder(`Broken ${shape.key}`, `broken-${shape.key}`, shape.value),
		),
		// A hole in the list itself: `null` survives a truncated write, and it used
		// to throw inside dedupeChoicesById during loadSettings.
		null as unknown as IChoice,
		"stray" as unknown as IChoice,
		leaf("Tail template", "tail"),
	];
}

/** The ids of the choices in `malformedTree()` that are perfectly well-formed. */
export const HEALTHY_IDS = ["head", "healthy", "child", "tail"];

/**
 * Every unreadable `choices` value still in the tree, keyed by folder id, as a
 * comparable string. This is what the preservation assertions compare: an edit
 * elsewhere in the tree must not rewrite, drop, or "repair" any of them.
 *
 * List holes (`null`, a stray primitive) are deliberately NOT tracked. They hold
 * nothing recoverable, so a walker is free to step over one or drop it; only a
 * folder's children value can be hiding real choices.
 */
export function malformedSnapshot(choices: IChoice[]): string {
	const seen: unknown[] = [];
	const walk = (list: unknown) => {
		if (!Array.isArray(list)) return;
		for (const entry of list) {
			if (typeof entry !== "object" || entry === null) continue;
			const node = entry as Record<string, unknown>;
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
