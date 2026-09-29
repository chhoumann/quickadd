export type * from "../types/packages/PackagePreview";
export { flagDescription, flagLabel, flagSeverity } from "./packagePreviewFlags";
import {
	INLINE_JAVASCRIPT_REGEX,
	JAVASCRIPT_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../constants";
import type IChoice from "../types/choices/IChoice";
import type { CapabilityRow, MissingReference, PackagePreview, PreviewChoice, PreviewFile, PreviewFlag, PreviewSeverity, PreviewSummary, PreviewUsageSite } from "../types/packages/PackagePreview";
import type {
	QuickAddPackage,
	QuickAddPackageAssetKind,
} from "../types/packages/QuickAddPackage";
import { decodeFromBase64 } from "../utils/base64";
import { flattenChoices } from "../utils/choiceUtils";
import { extractScriptFromMarkdown } from "../utils/extractScriptFromMarkdown";
import { hasTemplateExtension } from "../utils/templateFolderUtils";
import { collectTemplateIncludePaths } from "../utils/templateIncludes";
import { flagSeverity } from "./packagePreviewFlags";
import { walkPackage } from "./packagePreviewWalk";

/**
 * Pure, App-free analysis of a QuickAdd package for the import preview.
 *
 * Everything in this module is computed from the package payload + a set of
 * already-existing vault paths (and the importer's existing choices). It never
 * touches the Obsidian App, so it is unit-testable under jsdom and is the exact
 * model the import modal renders and the `quickadd:package-preview` CLI handler
 * returns.
 *
 * Key safety invariant: a file's "executable" status is decided from the
 * COMMAND GRAPH (is it referenced by a UserScript / script-mode Conditional?),
 * never from the package-declared `asset.kind`, which is an untrusted hint.
 */

function isScriptKind(kind: QuickAddPackageAssetKind): boolean {
	return kind === "user-script" || kind === "conditional-script";
}

const INLINE_JAVASCRIPT_GLOBAL_REGEX = new RegExp(INLINE_JAVASCRIPT_REGEX.source, "g");

/**
 * The code QuickAdd can run from a bundled file once it is in the vault, or
 * null when the file holds none. It mirrors the two places that execute vault
 * files, so the review asks you to read exactly the files that can run:
 * - the user-script loader (src/utils/userScript.ts) runs a `.js` file's bytes,
 *   or the first ```js fence of a `.md` note, and refuses every other file;
 * - the formatter runs each ```js quickadd fence in a template, and any
 *   `.md`, `.canvas` or `.base` file can be used as one.
 * The package-declared `kind` is an untrusted hint and plays no part.
 */
function bundledRunnableCode(originalPath: string, content: string): string | null {
	let decoded: string;
	try {
		decoded = decodeFromBase64(content);
	} catch {
		return null;
	}
	if (JAVASCRIPT_FILE_EXTENSION_REGEX.test(originalPath)) return decoded;
	if (!hasTemplateExtension(originalPath)) return null;

	const blocks: string[] = [];
	if (MARKDOWN_FILE_EXTENSION_REGEX.test(originalPath)) {
		const { code } = extractScriptFromMarkdown(decoded);
		if (code) blocks.push(code);
	}
	for (const match of decoded.matchAll(INLINE_JAVASCRIPT_GLOBAL_REGEX)) {
		const code = match[1]?.trim();
		if (code) blocks.push(code);
	}
	return blocks.length > 0 ? blocks.join("\n") : null;
}

// #714: a bundled script that wires up QuickAdd's AI tool-calling lets an AI MODEL
// read and write the vault with model-chosen arguments — a distinct risk class from
// "this script runs". Detect the common surface forms: `quickAddApi.ai.tools/.agent/
// .tool(...)`, the destructured `ai.tools/agent/tool(...)`, and the built-in groups
// (`tools.vault/workspace/system(...)`). A heuristic for DISCLOSURE only — the
// security floor (any script ⇒ "full vault + network access, gated") already holds.
const AI_TOOLS_USE_REGEX =
	/\bai\s*\.\s*(?:tools|agent|tool)\b|\btools\s*\.\s*(?:vault|workspace|system)\s*\(/;
function scriptUsesAiTools(code: string): boolean {
	return AI_TOOLS_USE_REGEX.test(code);
}

const SEVERITY_ORDER: Record<PreviewSeverity, number> = {
	critical: 0,
	warning: 1,
	info: 2,
};


// --- Public analysis --------------------------------------------------------

/**
 * Every script/template path the package references (deduped), including the
 * `{{TEMPLATE:...}}` includes inside bundled templates. The orchestrator uses
 * this to resolve existence for both bundled and unbundled references in a
 * single vault pass.
 */
export function collectReferencedAssetPaths(pkg: QuickAddPackage): string[] {
	return Array.from(collectPackageUsages(pkg, walkPackage(pkg).choiceWalks).keys());
}

// Matches the formatter's inclusion depth cap; bounds a crafted package whose
// bundled notes include each other in a cycle.
const MAX_INCLUDE_ROUNDS = 10;

/**
 * Usage sites indexed by referenced path: the command-graph references from
 * the walk, plus every `{{TEMPLATE:...}}` include found inside a bundled note
 * that some choice uses as a template (transitively). Includes are attributed
 * to the choice(s) whose template pulls them in, so the preview can name where
 * a missing or bundled include comes from.
 */
function collectPackageUsages(
	pkg: QuickAddPackage,
	choiceWalks: ReturnType<typeof walkPackage>["choiceWalks"],
): Map<string, PreviewUsageSite[]> {
	const usagesByPath = new Map<string, PreviewUsageSite[]>();
	const addUsage = (usage: PreviewUsageSite) => {
		if (!usage.path) return;
		const list = usagesByPath.get(usage.path) ?? [];
		list.push(usage);
		usagesByPath.set(usage.path, list);
	};
	for (const walk of choiceWalks) {
		for (const usage of walk.usages) addUsage(usage);
	}

	const assetsByPath = new Map(pkg.assets.map((asset) => [asset.originalPath, asset]));
	const scanned = new Set<string>();
	let frontier = Array.from(usagesByPath.keys());
	for (let round = 0; round < MAX_INCLUDE_ROUNDS && frontier.length > 0; round++) {
		const next: string[] = [];
		for (const path of frontier) {
			if (scanned.has(path)) continue;
			const asset = assetsByPath.get(path);
			if (!asset || !hasTemplateExtension(path)) continue;
			// A note referenced only as a script runs its js fence; the formatter
			// never resolves includes in it. Leave it unscanned so a later
			// `{{TEMPLATE:...}}` reference to the same note still gets a walk.
			const templateUsages = (usagesByPath.get(path) ?? []).filter((u) => !u.asScript);
			if (templateUsages.length === 0) continue;
			scanned.add(path);
			let decoded: string;
			try {
				decoded = decodeFromBase64(asset.content);
			} catch {
				continue;
			}
			const includes = collectTemplateIncludePaths(decoded);
			if (includes.size === 0) continue;
			const referrers = new Map<string, PreviewUsageSite>();
			for (const usage of templateUsages) {
				if (!referrers.has(usage.choiceId)) referrers.set(usage.choiceId, usage);
			}
			for (const include of includes) {
				for (const referrer of referrers.values()) {
					addUsage({
						choiceId: referrer.choiceId,
						path: include,
						asScript: false,
						impliedKind: "template",
						breadcrumb: `${referrer.breadcrumb} › {{TEMPLATE}} include`,
					});
				}
				if (!scanned.has(include)) next.push(include);
			}
		}
		frontier = next;
	}

	return usagesByPath;
}

// Cheap decoded-size estimate (no decode). Assumes RFC 4648 base64 as produced
// by btoa/Buffer; the floor handles unpadded input correctly too.
function estimateBytesFromBase64(content: string): number {
	const len = content.length;
	if (len === 0) return 0;
	let padding = 0;
	if (content.endsWith("==")) padding = 2;
	else if (content.endsWith("=")) padding = 1;
	return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

function flagComparator(a: PreviewFlag, b: PreviewFlag): number {
	return SEVERITY_ORDER[flagSeverity(a)] - SEVERITY_ORDER[flagSeverity(b)];
}

/**
 * Build the full preview model.
 *
 * @param existingChoices the importer's current choices (for id-collision detection)
 * @param pkg the parsed package
 * @param existsByPath paths (bundled or referenced) that already exist in the vault
 */
export function buildPackagePreview(
	existingChoices: IChoice[],
	pkg: QuickAddPackage,
	existsByPath: ReadonlySet<string>,
): PackagePreview {
	const { choiceWalks } = walkPackage(pkg);
	const existingById = new Set(
		flattenChoices(existingChoices).map((choice) => choice.id),
	);

	// Usage sites by referenced path (command graph + template includes).
	const usagesByPath = collectPackageUsages(pkg, choiceWalks);
	const referencedAsScript = new Set<string>();
	for (const [path, usages] of usagesByPath) {
		if (usages.some((u) => u.asScript)) referencedAsScript.add(path);
	}

	const bundledPaths = new Set(pkg.assets.map((asset) => asset.originalPath));

	const runnableCodeByPath = new Map(
		pkg.assets.map((asset) => [
			asset.originalPath,
			bundledRunnableCode(asset.originalPath, asset.content),
		]),
	);

	// Files manifest (one per bundled asset).
	const files: PreviewFile[] = pkg.assets.map((asset) => {
		const usages = usagesByPath.get(asset.originalPath) ?? [];
		const executable = referencedAsScript.has(asset.originalPath);
		const requiresReview =
			executable || runnableCodeByPath.get(asset.originalPath) != null;
		return {
			originalPath: asset.originalPath,
			kind: asset.kind,
			bundled: true,
			executable,
			requiresReview,
			exists: existsByPath.has(asset.originalPath),
			sizeBytes: estimateBytesFromBase64(asset.content),
			orphan: usages.length === 0,
			referencedBy: usages,
		};
	});

	// Choices.
	const choices: PreviewChoice[] = choiceWalks.map((walk) => {
		const exists = existingById.has(walk.choiceId);
		const flags = Array.from(walk.flags);
		if (exists) flags.push("overwrites-existing-choice");
		flags.sort(flagComparator);
		return {
			choiceId: walk.choiceId,
			name: walk.name,
			type: walk.type,
			location: walk.location,
			exists,
			registersCommand: walk.registersCommand,
			flags,
			commands: walk.commands,
		};
	});

	// Missing references: referenced but neither bundled nor present in vault.
	const missingReferences: MissingReference[] = [];
	for (const [path, usages] of usagesByPath) {
		if (bundledPaths.has(path)) continue;
		if (existsByPath.has(path)) continue; // will reuse an existing vault file
		const asScript = usages.some((u) => u.asScript);
		missingReferences.push({
			path,
			asScript,
			breadcrumb: usages[0]?.breadcrumb ?? path,
		});
	}

	const orphanAssets = files.filter((file) => file.orphan).map((f) => f.originalPath);

	// Capability rows: granular critical/per-item rows from the walk, plus
	// aggregated warning rows for counts.
	const capabilityRows: CapabilityRow[] = [];
	for (const walk of choiceWalks) {
		for (const row of walk.rows) capabilityRows.push(row);
	}

	// Mislabeled executable: a bundled file run as a script whose declared kind
	// is not a script kind.
	for (const file of files) {
		if (!file.executable) continue;
		if (isScriptKind(file.kind)) continue;
		capabilityRows.push({
			flag: "mislabeled-executable",
			severity: "critical",
			title: "Runs a file as code even though it is labeled a template",
			detail: file.originalPath,
			scriptPath: file.originalPath,
		});
	}

	// A bundled file written to disk can be executed by any macro or template
	// that points at its path (in this package OR already in the user's vault),
	// so it must be reviewed even when no choice in THIS package references it.
	// bundledRunnableCode decides which files can run, whatever `kind` the
	// package claims.
	for (const file of files) {
		if (!file.requiresReview) continue;
		if (file.executable) continue; // already a critical user-script/mislabeled row + in criticalScriptPaths
		capabilityRows.push({
			flag: "bundled-script",
			severity: "critical",
			title: "Bundles a file that will be written to your vault and can be run as code",
			detail: file.originalPath,
			scriptPath: file.originalPath,
		});
	}

	// AI-tools disclosure (#714): scan each reviewable bundled script for AI
	// tool-calling and surface a distinct critical row. Scans the SAME decoded code
	// QuickAdd runs, so a note that hides a js fence is covered too.
	for (const file of files) {
		const code = runnableCodeByPath.get(file.originalPath);
		if (!code || !scriptUsesAiTools(code)) continue;
		capabilityRows.push({
			flag: "ai-tools",
			severity: "critical",
			title: "Lets an AI model read and write your vault",
			detail: file.originalPath,
			scriptPath: file.originalPath,
		});
	}

	const registersCommandCount = choices.filter((c) => c.registersCommand).length;
	if (registersCommandCount > 0) {
		capabilityRows.push({
			flag: "registers-command",
			severity: "warning",
			title: "Adds commands to the command palette",
			detail: `${registersCommandCount} choice${registersCommandCount === 1 ? "" : "s"
				}`,
		});
	}

	const overwriteChoiceCount = choices.filter((c) => c.exists).length;
	if (overwriteChoiceCount > 0) {
		capabilityRows.push({
			flag: "overwrites-existing-choice",
			severity: "warning",
			title: "Replaces choices that already exist in your vault",
			detail: `${overwriteChoiceCount} choice${overwriteChoiceCount === 1 ? "" : "s"
				}`,
		});
	}

	const overwriteFileCount = files.filter((f) => f.exists).length;
	if (overwriteFileCount > 0) {
		capabilityRows.push({
			flag: "overwrites-existing-file",
			severity: "warning",
			title: "Overwrites existing files in your vault",
			detail: `${overwriteFileCount} file${overwriteFileCount === 1 ? "" : "s"}`,
		});
	}

	if (missingReferences.length > 0) {
		const scriptMissing = missingReferences.filter((m) => m.asScript).length;
		capabilityRows.push({
			// A missing SCRIPT runs from whatever file exists at that path: an
			// execution-hijack risk, so it ranks critical (and requires the gate).
			flag: "missing-reference",
			severity: scriptMissing > 0 ? "critical" : "warning",
			title:
				scriptMissing > 0
					? "References scripts that are not bundled, so they run from whatever exists at those paths after import"
					: "References files that are not bundled and not in your vault",
			detail: `${missingReferences.length} reference${missingReferences.length === 1 ? "" : "s"
				}`,
		});
	}

	capabilityRows.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

	const criticalScriptPaths = files
		.filter((file) => file.requiresReview)
		.map((file) => file.originalPath);

	const scriptCount = referencedAsScript.size;
	const runsOnStartup = choiceWalks.some((w) => w.flags.has("run-on-startup"));
	const criticalCount = capabilityRows.filter((r) => r.severity === "critical").length;
	const warningCount = capabilityRows.filter((r) => r.severity === "warning").length;

	const summary: PreviewSummary = {
		hasCritical: criticalCount > 0,
		hasWarning: warningCount > 0,
		criticalCount,
		warningCount,
		runsOnStartup,
		scriptCount,
		registersCommandCount,
		overwritesChoices: overwriteChoiceCount,
		overwritesFiles: overwriteFileCount,
		missingCount: missingReferences.length,
	};

	return {
		quickAddVersion: pkg.quickAddVersion,
		createdAt: pkg.createdAt,
		choiceCount: pkg.choices.length,
		fileCount: pkg.assets.length,
		choices,
		files,
		capabilityRows,
		missingReferences,
		orphanAssets,
		criticalScriptPaths,
		summary,
	};
}

// --- Lazy content preview + gate predicates ---------------------------------

/** Cap on previewed characters; larger scripts are flagged truncated. */
export const MAX_PREVIEW_CHARS = 100_000;

export interface AssetPreviewContent {
	found: boolean;
	text: string;
	truncated: boolean;
	sizeBytes: number;
	looksMinified: boolean;
	error?: string;
}

function byteLength(text: string): number {
	if (typeof TextEncoder !== "undefined") {
		return new TextEncoder().encode(text).length;
	}
	return text.length;
}

function looksMinified(text: string): boolean {
	if (text.length < 1000) return false;
	let longestLine = 0;
	let lineCount = 1;
	let current = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "\n") {
			if (current > longestLine) longestLine = current;
			current = 0;
			lineCount++;
		} else {
			current++;
		}
	}
	if (current > longestLine) longestLine = current;
	const avgPerLine = text.length / lineCount;
	return longestLine > 1000 || avgPerLine > 250;
}

/**
 * Decode a bundled asset's content for display. Lazy by design — call this only
 * when the user expands a file, never during initial analysis.
 */
export function decodeAssetPreview(
	pkg: QuickAddPackage,
	originalPath: string,
): AssetPreviewContent {
	const asset = pkg.assets.find((a) => a.originalPath === originalPath);
	if (!asset) {
		return {
			found: false,
			text: "",
			truncated: false,
			sizeBytes: 0,
			looksMinified: false,
			error: "File is not bundled in this package.",
		};
	}

	try {
		const decoded = decodeFromBase64(asset.content);
		const truncated = decoded.length > MAX_PREVIEW_CHARS;
		const text = truncated ? decoded.slice(0, MAX_PREVIEW_CHARS) : decoded;
		return {
			found: true,
			text,
			truncated,
			sizeBytes: byteLength(decoded),
			// Scan only the previewed slice — enough to spot minification.
			looksMinified: looksMinified(text),
		};
	} catch (error) {
		return {
			found: true,
			text: "",
			truncated: false,
			sizeBytes: 0,
			looksMinified: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** A package needs explicit acknowledgement when it has any critical capability. */
export function requiresAcknowledgement(preview: PackagePreview): boolean {
	return preview.summary.hasCritical;
}

/**
 * True when every bundled critical script has been expanded/reviewed at least
 * once. Used to gate the acknowledgement checkbox.
 */
export function isFullyReviewed(
	preview: PackagePreview,
	reviewedScriptPaths: ReadonlySet<string>,
): boolean {
	return preview.criticalScriptPaths.every((path) =>
		reviewedScriptPaths.has(path),
	);
}
