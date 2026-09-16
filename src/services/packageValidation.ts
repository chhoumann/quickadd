import { normalizePath } from "obsidian";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { CommandType } from "../types/macros/CommandType";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { ICommand } from "../types/macros/ICommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type { QuickAddPackage } from "../types/packages/QuickAddPackage";
import {
	isQuickAddPackage,
	QUICKADD_PACKAGE_SCHEMA_VERSION,
} from "../types/packages/QuickAddPackage";
import {
	childChoicesOf
} from "../utils/choiceUtils";

export function parseQuickAddPackage(raw: string): QuickAddPackage {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`Package content is not valid JSON: ${(error as Error)?.message ?? error}`,
		);
	}

	if (!isQuickAddPackage(parsed)) {
		throw new Error("Content is not a valid QuickAdd package.");
	}

	if (parsed.schemaVersion > QUICKADD_PACKAGE_SCHEMA_VERSION) {
		throw new Error(
			`Package schema version ${parsed.schemaVersion} is newer than this plugin supports (${QUICKADD_PACKAGE_SCHEMA_VERSION}).`,
		);
	}

	// Reject duplicate destinations: preview reads the first asset, while import writes the last.
	// last-write-wins per destination while the review pane resolves the FIRST
	// match (decodeAssetPreview), so two assets at one path could show benign bytes
	// in review while malicious bytes land on disk — a silent review-gate desync.
	// Failing closed here keeps reviewed bytes identical to written bytes.
	const duplicateAssetPath = findDuplicateAssetPath(parsed.assets);
	if (duplicateAssetPath !== null) {
		throw new Error(
			`Package contains duplicate asset path "${duplicateAssetPath}". Each asset must have a unique path.`,
		);
	}

	// All copies of a choice must match: preview reads flat entries while import installs inline children.
	// same choice id can appear in MORE than one place in a package: as a flat
	// `pkg.choices` entry AND inline inside a Multi's `choices` array (or as a
	// NestedChoice/Conditional-branch embedded choice). The preview and the writer
	// each pick ONE of those copies and assume the others are identical:
	// buildPackagePreview's walk SKIPS an inline Multi child whose id is also an
	// entry (trusting the entry's walk to cover it), while applyPackageImport's
	// remapChoiceTree INSTALLS the inline copy and drops the standalone entry. A
	// crafted package can make those copies DIVERGE — a benign top-level entry that
	// the preview discloses, paired with a malicious inline child (e.g.
	// runOnStartup:true) that actually installs — suppressing the capability
	// disclosure and acknowledgement gate entirely. The structural validator
	// (isQuickAddPackage) never checks this. A legitimately-exported package always
	// clones every appearance of an id from one source choice, so all appearances
	// are identical; divergence implies tampering. Fail closed so the copy the user
	// reviews is provably the copy that installs.
	const divergentChoiceId = findDivergentChoiceId(parsed.choices);
	if (divergentChoiceId !== null) {
		throw new Error(
			`Package contains conflicting definitions for choice "${divergentChoiceId}". Each choice id must describe the same choice everywhere it appears.`,
		);
	}

	// Import installs parented entries through their parent. Reject children missing from that parent.
	// inline. applyPackageImport installs a child SOLELY through its parent Multi's
	// inline `choices` (remapChoiceTree keeps only the children listed there) and,
	// in the insertion loop, SKIPS the child's own flat entry assuming the parent
	// will carry it. So a hand-edited/cross-version package where entry X names
	// parentChoiceId=M (M an importable entry) while M does not list X inline would
	// import X nowhere — silently dropped while the preview still listed X and the
	// import reports success. A legitimately exported package always inlines a
	// parented child as a direct member of its parent Multi, so failing closed here
	// keeps the previewed set of choices identical to the installed set.
	const uncarriedChildId = findUncarriedChildChoiceId(parsed.choices);
	if (uncarriedChildId !== null) {
		throw new Error(
			`Package choice "${uncarriedChildId}" names a parent that does not list it as a child. Each parented choice must appear inside its parent.`,
		);
	}

	return parsed;
}

function findDuplicateAssetPath(
	assets: QuickAddPackage["assets"],
): string | null {
	const seen = new Set<string>();
	for (const asset of assets) {
		// Compare normalized destinations, matching the writer; path confinement is checked separately.
		const key = normalizePath(asset.originalPath ?? "");
		if (seen.has(key)) return asset.originalPath;
		seen.add(key);
	}
	return null;
}

/**
 * Compare every contained appearance, including macro branches, using full subtree content.
 * Ignore object key order; preserve array order.
 */
function findDivergentChoiceId(
	choices: QuickAddPackage["choices"],
): string | null {
	const canonicalById = new Map<string, string>();
	let divergentId: string | null = null;

	const visit = (choice: IChoice | null | undefined): void => {
		if (divergentId !== null) return;
		if (!choice || typeof choice !== "object") return;

		const id = (choice as { id?: unknown }).id;
		if (typeof id === "string") {
			const canonical = canonicalizeJsonValue(choice);
			const prior = canonicalById.get(id);
			if (prior === undefined) {
				canonicalById.set(id, canonical);
			} else if (prior !== canonical) {
				divergentId = id;
				return;
			}
		}

		if (choice.type === "Multi") {
			const multi = choice as IMultiChoice;
			if (Array.isArray(multi.choices)) {
				for (const child of multi.choices) visit(child);
			}
		}

		if (choice.type === "Macro") {
			const macro = choice as IMacroChoice;
			visitNestedChoicesInCommands(macro.macro?.commands, visit);
		}
	};

	for (const entry of choices) {
		if (divergentId !== null) break;
		visit(entry?.choice);
	}

	return divergentId;
}

function visitNestedChoicesInCommands(
	commands: ICommand[] | undefined,
	visit: (choice: IChoice | null | undefined) => void,
): void {
	if (!Array.isArray(commands)) return;
	for (const command of commands) {
		if (!command) continue;
		if (command.type === CommandType.NestedChoice) {
			visit((command as INestedChoiceCommand).choice);
		} else if (command.type === CommandType.Conditional) {
			const conditional = command as IConditionalCommand;
			visitNestedChoicesInCommands(conditional.thenCommands, visit);
			visitNestedChoicesInCommands(conditional.elseCommands, visit);
		}
	}
}

/**
 * Canonical JSON preserves array order and own keys, including __proto__.
 */
function canonicalizeJsonValue(value: unknown): string {
	if (value === null || typeof value !== "object") {
		const serialized = JSON.stringify(value);
		// `undefined` (not valid JSON, never produced by JSON.parse) stringifies to
		// the JS value `undefined`; encode it distinctly so it can't collide with a
		// real value.
		return serialized === undefined ? "\u0000undefined" : serialized;
	}
	if (Array.isArray(value)) {
		return `[${value.map(canonicalizeJsonValue).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `{${keys
		.map((key) => `${JSON.stringify(key)}:${canonicalizeJsonValue(record[key])}`)
		.join(",")}}`;
}

/**
 * A packaged parent must carry its child directly. External parents are resolved in the vault.
 */
function findUncarriedChildChoiceId(
	choices: QuickAddPackage["choices"],
): string | null {
	const entryById = new Map(choices.map((entry) => [entry.choice.id, entry]));

	for (const entry of choices) {
		const parentId = entry.parentChoiceId;
		if (parentId === null) continue;

		const parentEntry = entryById.get(parentId);
		if (!parentEntry) continue;

		const parent = parentEntry.choice;
		const carriedInline = childChoicesOf(parent).some(
			(child) => child?.id === entry.choice.id,
		);
		if (!carriedInline) return entry.choice.id;
	}

	return null;
}

