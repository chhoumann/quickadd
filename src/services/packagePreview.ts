import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { ICommand } from "../types/macros/ICommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type { ConditionalCondition } from "../types/macros/Conditional/types";
import { CommandType } from "../types/macros/CommandType";
import type {
	QuickAddPackage,
	QuickAddPackageAssetKind,
} from "../types/packages/QuickAddPackage";
import { flattenChoices } from "../utils/choiceUtils";
import { decodeFromBase64 } from "../utils/base64";
import { extractScriptFromMarkdown } from "../utils/extractScriptFromMarkdown";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";

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

export type PreviewSeverity = "critical" | "warning" | "info";

export type PreviewFlag =
	| "user-script"
	| "conditional-script"
	| "bundled-script"
	| "run-on-startup"
	| "mislabeled-executable"
	| "registers-command"
	| "obsidian-command"
	| "ai"
	| "ai-tools"
	| "capture-writes"
	| "template-write"
	| "overwrites-existing-choice"
	| "overwrites-existing-file"
	| "missing-reference"
	| "unknown-command"
	| "editor-command"
	| "open-file";

interface FlagMeta {
	severity: PreviewSeverity;
	/** Short uppercase pill label. */
	label: string;
	/** Plain-language hover explanation. */
	description: string;
}

// One row per flag — severity, pill label, and hover description in lockstep so
// adding a capability can't half-define it across parallel tables.
const FLAG_META: Record<PreviewFlag, FlagMeta> = {
	"user-script": {
		severity: "critical",
		label: "SCRIPT",
		description: "Runs custom JavaScript with full access to your vault and the network.",
	},
	"conditional-script": {
		severity: "critical",
		label: "CONDITIONAL",
		description: "Runs custom JavaScript to decide which branch executes.",
	},
	"bundled-script": {
		severity: "critical",
		label: "SCRIPT FILE",
		description: "Bundles a JavaScript file that will be written to your vault and can be run as code.",
	},
	"run-on-startup": {
		severity: "critical",
		label: "STARTUP",
		description: "Runs automatically every time Obsidian starts.",
	},
	"mislabeled-executable": {
		severity: "critical",
		label: "EXECUTABLE",
		description: "A bundled file is run as code even though it is labeled a template.",
	},
	"registers-command": {
		severity: "warning",
		label: "COMMAND",
		description: "Adds a command to the command palette.",
	},
	"obsidian-command": {
		severity: "warning",
		label: "OBSIDIAN",
		description: "Triggers another Obsidian command.",
	},
	ai: {
		severity: "warning",
		label: "AI",
		description: "Sends note content to your AI provider over the network.",
	},
	"ai-tools": {
		severity: "critical",
		label: "AI TOOLS",
		description:
			"Lets an AI model read and write your vault: the script gives the model tools (functions) it calls with model-chosen arguments.",
	},
	"capture-writes": {
		severity: "warning",
		label: "WRITES",
		description: "Writes captured text into your notes.",
	},
	"template-write": {
		severity: "warning",
		label: "TEMPLATE",
		description: "Creates notes from a bundled template.",
	},
	"overwrites-existing-choice": {
		severity: "warning",
		label: "OVERWRITES",
		description: "Replaces a choice that already exists in your vault.",
	},
	"overwrites-existing-file": {
		severity: "warning",
		label: "OVERWRITES",
		description: "Overwrites a file that already exists in your vault.",
	},
	"missing-reference": {
		severity: "warning",
		label: "MISSING",
		description: "References a file that is not bundled in this package.",
	},
	"unknown-command": {
		severity: "warning",
		label: "UNKNOWN",
		description: "An unrecognised command type. Review it manually.",
	},
	"editor-command": {
		severity: "info",
		label: "EDITOR",
		description: "Runs a built-in editor command.",
	},
	"open-file": {
		severity: "info",
		label: "OPEN FILE",
		description: "Opens a file in your vault.",
	},
};

export function flagSeverity(flag: PreviewFlag): PreviewSeverity {
	return FLAG_META[flag].severity;
}

export function flagLabel(flag: PreviewFlag): string {
	return FLAG_META[flag].label;
}

export function flagDescription(flag: PreviewFlag): string {
	return FLAG_META[flag].description;
}

function isScriptKind(kind: QuickAddPackageAssetKind): boolean {
	return kind === "user-script" || kind === "conditional-script";
}

// A bundled asset that can be executed as code: a declared script kind, OR
// any file with a `.js` destination path — because `kind` is an untrusted
// hint and a macro (in this package or already in the vault) will load any
// `.js` at its path as a user script. Path-only check keeps this App-free.
const EXECUTABLE_ASSET_PATH_REGEX = /\.js$/i;
function isExecutableBundledAsset(
	kind: QuickAddPackageAssetKind,
	originalPath: string,
): boolean {
	return isScriptKind(kind) || EXECUTABLE_ASSET_PATH_REGEX.test(originalPath);
}

// Since #1065 a `.md` note is loadable as a user script (its first ```js fence
// runs). The `.js` path check above can't see that, so a bundled note that lies
// about its `kind` (e.g. "template") and is referenced by no choice would slip the
// disclosure gate, land on disk, and run via any macro pointing at its path.
// Decode the bundled content and run the SAME extractor the loader uses: only a
// note that actually contains a runnable js fence is treated as executable, so
// plain `.md` templates are not flagged. Pure/App-free — operates on the payload.
function markdownAssetIsExecutable(
	originalPath: string,
	content: string,
): boolean {
	if (!MARKDOWN_FILE_EXTENSION_REGEX.test(originalPath)) return false;
	let decoded: string;
	try {
		decoded = decodeFromBase64(content);
	} catch {
		return false;
	}
	const { code } = extractScriptFromMarkdown(decoded);
	return code !== null && code.length > 0;
}

// The runnable code of a bundled executable asset, for static disclosure scans:
// a `.md` note yields its first js fence (what the loader runs); any other
// executable asset (a `.js`, or a script-kind asset) yields its decoded body.
// Pure/App-free — operates on the bundled payload only.
function bundledScriptCode(originalPath: string, content: string): string | null {
	let decoded: string;
	try {
		decoded = decodeFromBase64(content);
	} catch {
		return null;
	}
	if (MARKDOWN_FILE_EXTENSION_REGEX.test(originalPath)) {
		const { code } = extractScriptFromMarkdown(decoded);
		return code !== null && code.length > 0 ? code : null;
	}
	return decoded;
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

const KNOWN_COMMAND_TYPES = new Set<string>(Object.values(CommandType));

/** A site where a script/template file path is referenced. */
export interface PreviewUsageSite {
	choiceId: string;
	path: string;
	/** Referenced as an executable script (UserScript / script-mode Conditional). */
	asScript: boolean;
	/** The asset kind this reference implies, regardless of the bundled kind. */
	impliedKind: QuickAddPackageAssetKind;
	/** Human-readable location, e.g. "Daily Sync › fetch (User Script)". */
	breadcrumb: string;
}

/** A flattened command in a macro, for the read-only "Show macro" disclosure. */
export interface PreviewCommand {
	name: string;
	type: string;
	depth: number;
	flag?: PreviewFlag;
	scriptPath?: string;
	summary?: string;
}

export interface PreviewChoice {
	choiceId: string;
	name: string;
	type: string;
	/** Folder location (does not include the choice's own name). */
	location: string;
	/** Id already present in the importer's vault -> will overwrite a choice. */
	exists: boolean;
	registersCommand: boolean;
	flags: PreviewFlag[];
	commands: PreviewCommand[];
}

export interface PreviewFile {
	originalPath: string;
	kind: QuickAddPackageAssetKind;
	/** Present in pkg.assets (content available to preview). */
	bundled: boolean;
	/** Decided from the command graph, NOT from `kind`. */
	executable: boolean;
	/** Must be opened before the package import acknowledgement gate can pass. */
	requiresReview: boolean;
	/** Default destination already exists -> import will overwrite it. */
	exists: boolean;
	/** Cheap decoded-size estimate from base64 length (no decode). */
	sizeBytes: number;
	/** Bundled but referenced by no choice/command. */
	orphan: boolean;
	referencedBy: PreviewUsageSite[];
}

export interface CapabilityRow {
	flag: PreviewFlag;
	severity: PreviewSeverity;
	/** Plain-language description of what the capability does. */
	title: string;
	/** Location / count detail. */
	detail: string;
	/** Set for critical script rows; ties the row to the disclosure gate. */
	scriptPath?: string;
}

export interface MissingReference {
	path: string;
	asScript: boolean;
	breadcrumb: string;
}

export interface PreviewSummary {
	hasCritical: boolean;
	hasWarning: boolean;
	criticalCount: number;
	warningCount: number;
	runsOnStartup: boolean;
	scriptCount: number;
	registersCommandCount: number;
	overwritesChoices: number;
	overwritesFiles: number;
	missingCount: number;
}

export interface PackagePreview {
	quickAddVersion: string;
	createdAt: string;
	choiceCount: number;
	fileCount: number;
	choices: PreviewChoice[];
	files: PreviewFile[];
	capabilityRows: CapabilityRow[];
	missingReferences: MissingReference[];
	orphanAssets: string[];
	/** Bundled executable scripts the user must review to satisfy the gate. */
	criticalScriptPaths: string[];
	summary: PreviewSummary;
}

// --- Walk -------------------------------------------------------------------

interface ChoiceWalk {
	choiceId: string;
	name: string;
	type: string;
	location: string;
	registersCommand: boolean;
	flags: Set<PreviewFlag>;
	commands: PreviewCommand[];
	usages: PreviewUsageSite[];
	/** Granular critical/warning rows attributable to this choice. */
	rows: CapabilityRow[];
}

interface PackageWalk {
	choiceWalks: ChoiceWalk[];
}

function joinCrumb(parts: Array<string | undefined>): string {
	return parts.filter((part): part is string => Boolean(part)).join(" › ");
}

function commandLabel(command: ICommand): string {
	const name = command.name?.trim();
	return name && name.length > 0 ? name : String(command.type);
}

function conditionSummary(condition: ConditionalCondition): string {
	if (condition.mode === "script") {
		return `script: ${condition.scriptPath}${
			condition.exportName ? ` (${condition.exportName})` : ""
		}`;
	}
	const expected =
		condition.expectedValue !== undefined ? ` ${condition.expectedValue}` : "";
	return `${condition.variableName} ${condition.operator}${expected}`;
}

function isMacroChoice(choice: IChoice): choice is IMacroChoice {
	return choice.type === "Macro";
}

function isMultiChoice(choice: IChoice): choice is IMultiChoice {
	return choice.type === "Multi";
}

function isTemplateChoice(choice: IChoice): choice is ITemplateChoice {
	return choice.type === "Template";
}

function isCaptureChoice(choice: IChoice): choice is ICaptureChoice {
	return choice.type === "Capture";
}

/** True when a template's file-exists behavior can modify an existing note. */
function templateModifiesExisting(choice: ITemplateChoice): boolean {
	const behavior = choice.fileExistsBehavior;
	if (!behavior || behavior.kind !== "apply") return false;
	return (
		behavior.mode === "overwrite" ||
		behavior.mode === "appendTop" ||
		behavior.mode === "appendBottom"
	);
}

function walkPackage(pkg: QuickAddPackage): PackageWalk {
	const choiceWalks: ChoiceWalk[] = [];
	// Every choice that has its own top-level row. A Multi child that is also a
	// separate entry is skipped during recursion (it gets its own walk), while an
	// inline-only child (present in a Multi.choices array but NOT an entry) is
	// recursed and attributed to its host — so a crafted package can't hide a
	// capability by inlining a child without listing it as an entry.
	const entryIds = new Set(pkg.choices.map((entry) => entry.choice.id));

	for (const entry of pkg.choices) {
		const choice = entry.choice;
		const location = joinCrumb(entry.pathHint.slice(0, -1)) || "Root";
		const walk: ChoiceWalk = {
			choiceId: choice.id,
			name: choice.name,
			type: choice.type,
			location,
			registersCommand: false,
			flags: new Set<PreviewFlag>(),
			commands: [],
			usages: [],
			rows: [],
		};

		collectChoice(choice, walk, [choice.name], entryIds, 0);

		choiceWalks.push(walk);
	}

	return { choiceWalks };
}

function collectChoice(
	choice: IChoice,
	walk: ChoiceWalk,
	crumbs: string[],
	entryIds: ReadonlySet<string>,
	depthLevel: number,
): void {
	if (choice.command) {
		walk.registersCommand = true;
		walk.flags.add("registers-command");
	}

	if (isMacroChoice(choice)) {
		if (choice.runOnStartup) {
			walk.flags.add("run-on-startup");
			walk.rows.push({
				flag: "run-on-startup",
				severity: "critical",
				title: "Runs automatically every time Obsidian starts",
				detail: joinCrumb(crumbs),
			});
		}
		collectCommands(choice.macro?.commands ?? [], walk, crumbs, entryIds, depthLevel);
	}

	if (isTemplateChoice(choice)) {
		if (choice.templatePath) {
			walk.usages.push({
				choiceId: walk.choiceId,
				path: choice.templatePath,
				asScript: false,
				impliedKind: "template",
				breadcrumb: joinCrumb([...crumbs, "template"]),
			});
		}
		if (templateModifiesExisting(choice)) {
			walk.flags.add("template-write");
		}
	}

	if (isCaptureChoice(choice)) {
		walk.flags.add("capture-writes");
		const createCfg = choice.createFileIfItDoesntExist;
		if (
			createCfg?.enabled &&
			createCfg.createWithTemplate &&
			createCfg.template
		) {
			walk.usages.push({
				choiceId: walk.choiceId,
				path: createCfg.template,
				asScript: false,
				impliedKind: "capture-template",
				breadcrumb: joinCrumb([...crumbs, "new-file template"]),
			});
		}
	}

	if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
		for (const child of choice.choices) {
			// Skip children that have their own top-level row (avoids double
			// counting); recurse inline-only children so they can't hide.
			if (entryIds.has(child.id)) continue;
			collectChoice(child, walk, [...crumbs, child.name], entryIds, depthLevel);
		}
	}
}

function collectCommands(
	commands: ICommand[],
	walk: ChoiceWalk,
	crumbs: string[],
	entryIds: ReadonlySet<string>,
	depth: number,
): void {
	for (const command of commands) {
		if (!command) continue;
		const label = commandLabel(command);
		const commandCrumbs = [...crumbs, label];

		switch (command.type) {
			case CommandType.UserScript: {
				const script = command as IUserScript;
				walk.flags.add("user-script");
				walk.commands.push({
					name: label,
					type: command.type,
					depth,
					flag: "user-script",
					scriptPath: script.path,
				});
				if (script.path) {
					walk.usages.push({
						choiceId: walk.choiceId,
						path: script.path,
						asScript: true,
						impliedKind: "user-script",
						breadcrumb: joinCrumb(commandCrumbs),
					});
					walk.rows.push({
						flag: "user-script",
						severity: "critical",
						title: "Runs custom JavaScript with full access to your vault and the network",
						detail: `${joinCrumb(commandCrumbs)} (${script.path})`,
						scriptPath: script.path,
					});
				}
				break;
			}
			case CommandType.Conditional: {
				const conditional = command as IConditionalCommand;
				const condition = conditional.condition;
				const summary = condition ? conditionSummary(condition) : undefined;
				const isScript =
					condition?.mode === "script" && Boolean(condition.scriptPath);
				walk.commands.push({
					name: label,
					type: command.type,
					depth,
					flag: isScript ? "conditional-script" : undefined,
					scriptPath: isScript ? condition.scriptPath : undefined,
					summary,
				});
				if (isScript) {
					const scriptPath = (condition as { scriptPath: string }).scriptPath;
					walk.flags.add("conditional-script");
					walk.usages.push({
						choiceId: walk.choiceId,
						path: scriptPath,
						asScript: true,
						impliedKind: "conditional-script",
						breadcrumb: joinCrumb(commandCrumbs),
					});
					walk.rows.push({
						flag: "conditional-script",
						severity: "critical",
						title: "Runs custom JavaScript chosen by a condition",
						detail: `${joinCrumb(commandCrumbs)} (${scriptPath})`,
						scriptPath,
					});
				}
				collectCommands(
					conditional.thenCommands ?? [],
					walk,
					[...commandCrumbs, "then"],
					entryIds,
					depth + 1,
				);
				collectCommands(
					conditional.elseCommands ?? [],
					walk,
					[...commandCrumbs, "else"],
					entryIds,
					depth + 1,
				);
				break;
			}
			case CommandType.NestedChoice: {
				const nested = command as INestedChoiceCommand;
				walk.commands.push({ name: label, type: command.type, depth });
				if (nested.choice) {
					// Embedded choice has no pkg.choices entry: recurse fully,
					// attributing its capabilities to this top-level choice.
					collectChoice(
						nested.choice,
						walk,
						[...commandCrumbs, nested.choice.name],
						entryIds,
						depth + 1,
					);
				}
				break;
			}
			case CommandType.Obsidian: {
				const obsidian = command as IObsidianCommand;
				walk.flags.add("obsidian-command");
				walk.commands.push({ name: label, type: command.type, depth });
				walk.rows.push({
					flag: "obsidian-command",
					severity: "warning",
					title: "Triggers another Obsidian command",
					detail: `${joinCrumb(commandCrumbs)}${
						obsidian.commandId ? ` (${obsidian.commandId})` : ""
					}`,
				});
				break;
			}
			case CommandType.AIAssistant:
			case CommandType.InfiniteAIAssistant: {
				walk.flags.add("ai");
				walk.commands.push({ name: label, type: command.type, depth });
				walk.rows.push({
					flag: "ai",
					severity: "warning",
					title: "Sends note content to your AI provider over the network",
					detail: joinCrumb(commandCrumbs),
				});
				break;
			}
			case CommandType.EditorCommand: {
				walk.flags.add("editor-command");
				walk.commands.push({ name: label, type: command.type, depth });
				break;
			}
			case CommandType.OpenFile: {
				walk.flags.add("open-file");
				walk.commands.push({ name: label, type: command.type, depth });
				break;
			}
			case CommandType.Choice:
			case CommandType.Wait: {
				walk.commands.push({ name: label, type: command.type, depth });
				break;
			}
			default: {
				if (!KNOWN_COMMAND_TYPES.has(String(command.type))) {
					walk.flags.add("unknown-command");
					walk.commands.push({
						name: label,
						type: String(command.type),
						depth,
						flag: "unknown-command",
					});
					walk.rows.push({
						flag: "unknown-command",
						severity: "warning",
						title: "Unknown capability. Review it manually.",
						detail: `${joinCrumb(commandCrumbs)} (${String(command.type)})`,
					});
				} else {
					walk.commands.push({ name: label, type: String(command.type), depth });
				}
				break;
			}
		}
	}
}

// --- Public analysis --------------------------------------------------------

/**
 * Every script/template path the package references (deduped). The orchestrator
 * uses this to resolve existence for both bundled and unbundled references in a
 * single vault pass.
 */
export function collectReferencedAssetPaths(pkg: QuickAddPackage): string[] {
	const { choiceWalks } = walkPackage(pkg);
	const paths = new Set<string>();
	for (const walk of choiceWalks) {
		for (const usage of walk.usages) {
			if (usage.path) paths.add(usage.path);
		}
	}
	return Array.from(paths);
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

	// Index usage sites by referenced path.
	const usagesByPath = new Map<string, PreviewUsageSite[]>();
	for (const walk of choiceWalks) {
		for (const usage of walk.usages) {
			const list = usagesByPath.get(usage.path) ?? [];
			list.push(usage);
			usagesByPath.set(usage.path, list);
		}
	}
	const referencedAsScript = new Set<string>();
	for (const [path, usages] of usagesByPath) {
		if (usages.some((u) => u.asScript)) referencedAsScript.add(path);
	}

	const bundledPaths = new Set(pkg.assets.map((asset) => asset.originalPath));

	// Files manifest (one per bundled asset).
	const files: PreviewFile[] = pkg.assets.map((asset) => {
		const usages = usagesByPath.get(asset.originalPath) ?? [];
		const executable = referencedAsScript.has(asset.originalPath);
		const requiresReview =
			executable ||
			isExecutableBundledAsset(asset.kind, asset.originalPath) ||
			markdownAssetIsExecutable(asset.originalPath, asset.content);
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

	// A bundled script file is written to disk and can be executed by any macro
	// that points at its path (in this package OR already in the user's vault),
	// so it must be reviewed even when no choice in THIS package references it.
	// isExecutableBundledAsset covers both declared script kinds AND `.js`-path
	// assets that lie about their `kind`.
	for (const file of files) {
		if (!file.requiresReview) continue;
		if (file.executable) continue; // already a critical user-script/mislabeled row + in criticalScriptPaths
		capabilityRows.push({
			flag: "bundled-script",
			severity: "critical",
			title: "Bundles a script file that will be written to your vault",
			detail: file.originalPath,
			scriptPath: file.originalPath,
		});
	}

	// AI-tools disclosure (#714): scan each reviewable bundled script for AI
	// tool-calling and surface a distinct critical row. Scans the SAME decoded code
	// the loader runs, so a note that hides a js fence is covered too.
	for (const file of files) {
		if (!file.requiresReview) continue;
		const asset = pkg.assets.find((a) => a.originalPath === file.originalPath);
		if (!asset) continue;
		const code = bundledScriptCode(asset.originalPath, asset.content);
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
			detail: `${registersCommandCount} choice${
				registersCommandCount === 1 ? "" : "s"
			}`,
		});
	}

	const overwriteChoiceCount = choices.filter((c) => c.exists).length;
	if (overwriteChoiceCount > 0) {
		capabilityRows.push({
			flag: "overwrites-existing-choice",
			severity: "warning",
			title: "Replaces choices that already exist in your vault",
			detail: `${overwriteChoiceCount} choice${
				overwriteChoiceCount === 1 ? "" : "s"
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
			detail: `${missingReferences.length} reference${
				missingReferences.length === 1 ? "" : "s"
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
