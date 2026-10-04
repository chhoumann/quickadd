import { inlineScriptBodies } from "../formatters/helpers/inlineScriptSpans";
import { normalizeVaultPath } from "../utils/pathUtils";
import { resolveTemplatePath } from "../utils/templateFolderUtils";
import type IChoice from "../types/choices/IChoice";
import { isCaptureChoice, isMacroChoice, isMultiChoice, isTemplateChoice } from "../types/choices/choiceType";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { CommandType } from "../types/macros/CommandType";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { ConditionalCondition } from "../types/macros/Conditional/types";
import type { ICommand } from "../types/macros/ICommand";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";
import type { IOpenFileCommand } from "../types/macros/QuickCommands/IOpenFileCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type {
	QuickAddPackage
} from "../types/packages/QuickAddPackage";
import { isChoiceLike } from "../utils/choiceUtils";
import { commandListOf, isCommandLike, macroCommandsValueOf } from "../utils/macroUtils";
import { captureFormatIncludes } from "../utils/packageTraversal";

import type { CapabilityRow, PreviewCommand, PreviewFlag, PreviewInlineScript, PreviewUsageSite } from "../types/packages/PackagePreview";
const KNOWN_COMMAND_TYPES = new Set<string>(Object.values(CommandType));
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
	inlineScripts: PreviewInlineScript[];
}

interface PackageWalk {
	choiceWalks: ChoiceWalk[];
}

function joinCrumb(parts: Array<string | undefined>): string {
	return parts.filter((part): part is string => Boolean(part)).join(" › ");
}

/**
 * Whether a step's name already shows its script path, as it does for the steps
 * the macro builder names after same-named scripts (#1850). A `::member` suffix
 * doesn't count. The review then shows the path once.
 */
export function isNamedAfterScript(label: string, scriptPath: string): boolean {
	return label.split("::")[0].trim() === scriptPath;
}

function crumbWithScriptPath(crumbs: string[], label: string, scriptPath: string): string {
	return isNamedAfterScript(label, scriptPath)
		? joinCrumb(crumbs)
		: `${joinCrumb(crumbs)} (${scriptPath})`;
}

function commandLabel(command: ICommand): string {
	const name = command.name?.trim();
	return name && name.length > 0 ? name : String(command.type);
}

function conditionSummary(condition: ConditionalCondition): string {
	if (condition.mode === "script") {
		return `script: ${condition.scriptPath}${condition.exportName ? ` (${condition.exportName})` : ""
			}`;
	}
	const expected =
		condition.expectedValue !== undefined ? ` ${condition.expectedValue}` : "";
	return `${condition.variableName} ${condition.operator}${expected}`;
}

/**
 * A choice's settings that the formatter runs through `format()`, which executes
 * every ```js quickadd fence first (CompleteFormatter.format). The template path
 * and a capture's new-file template are only scalar-formatted, so no code runs
 * from them. Listed whether or not the setting is switched on: one toggle after
 * import would run it without another review.
 */
function inlineScriptFields(choice: IChoice): Array<[field: string, value: unknown]> {
	if (isTemplateChoice(choice)) {
		const folders: unknown[] = Array.isArray(choice.folder?.folders) ? choice.folder.folders : [];
		return [
			["file name format", choice.fileNameFormat?.format],
			...folders.map((folder): [string, unknown] => ["folder", folder]),
		];
	}
	if (isCaptureChoice(choice)) {
		const property = choice.propertyCapture?.property;
		return [
			["capture to", choice.captureTo],
			["capture format", choice.format?.format],
			["insert after", choice.insertAfter?.after],
			["insert before", choice.insertBefore?.before],
			["property name", property?.kind === "named" ? property.format : undefined],
		];
	}
	return [];
}

function hasInlineScript(value: unknown): value is string {
	return typeof value === "string" && inlineScriptBodies(value).length > 0;
}

/** `crumbs` start with the top-level choice's name; the row names it, the code view doesn't. */
function recordInlineScript(walk: ChoiceWalk, crumbs: string[], text: string, addRow = true): void {
	walk.inlineScripts.push({ setting: joinCrumb(crumbs.slice(1)), text });
	if (!addRow) return;
	walk.flags.add("user-script");
	walk.rows.push({
		flag: "user-script",
		severity: "critical",
		title: "Runs custom JavaScript written into a choice setting",
		detail: joinCrumb(crumbs),
	});
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

export function walkPackage(pkg: QuickAddPackage): PackageWalk {
	const choiceWalks: ChoiceWalk[] = [];
	// Every choice that has its own top-level row. A Multi child that is also a
	// separate entry is skipped during recursion (it gets its own walk), while an
	// inline-only child (present in a Multi.choices array but NOT an entry) is
	// recursed and attributed to its host — so a crafted package can't hide a
	// capability by inlining a child without listing it as an entry.
	//
	// Skipping the same-id inline child is only safe because parseQuickAddPackage
	// (findDivergentChoiceId) rejects any package whose inline child diverges from
	// its same-id entry: the copy walked here is provably the copy applyPackageImport
	// installs. Without that boundary check a benign entry could mask a malicious
	// inline child (e.g. runOnStartup:true) and suppress the disclosure gate.
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
			inlineScripts: [],
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
		collectCommands(macroCommandsValueOf(choice.macro), walk, crumbs, entryIds, depthLevel);
	}

	if (isTemplateChoice(choice)) {
		if (choice.templatePath) {
			walk.usages.push({
				choiceId: walk.choiceId,
				path: resolveTemplatePath(choice.templatePath),
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
				path: resolveTemplatePath(createCfg.template),
				asScript: false,
				impliedKind: "capture-template",
				breadcrumb: joinCrumb([...crumbs, "new-file template"]),
			});
		}
		for (const path of captureFormatIncludes(choice)) {
			walk.usages.push({
				choiceId: walk.choiceId,
				path,
				asScript: false,
				impliedKind: "template",
				breadcrumb: joinCrumb([...crumbs, "{{TEMPLATE}} include"]),
			});
		}
	}

	// One row per setting, but every value is shown: a choice's folders all
	// share the "folder" row.
	const reported = new Set<string>();
	for (const [field, value] of inlineScriptFields(choice)) {
		if (!hasInlineScript(value)) continue;
		recordInlineScript(walk, [...crumbs, field], value, !reported.has(field));
		reported.add(field);
	}

	if (isMultiChoice(choice) && Array.isArray(choice.choices)) {
		for (const child of choice.choices) {
			// A packaged folder's list can hold a `null` hole like any other
			// (#1566); it carries nothing, so step over it rather than deref it.
			if (!isChoiceLike(child)) continue;
			// Skip children that have their own top-level row (avoids double
			// counting); recurse inline-only children so they can't hide.
			if (entryIds.has(child.id)) continue;
			collectChoice(child, walk, [...crumbs, child.name], entryIds, depthLevel);
		}
	}
}

function collectCommands(
	// `unknown`: raw `macro.commands` / branch values, straight from data.json.
	commands: unknown,
	walk: ChoiceWalk,
	crumbs: string[],
	entryIds: ReadonlySet<string>,
	depth: number,
): void {
	for (const command of commandListOf(commands)) {
		if (!isCommandLike(command)) continue;
		const label = commandLabel(command);
		const commandCrumbs = [...crumbs, label];
		const previewCommand: PreviewCommand = { name: label, type: command.type, depth };
		walk.commands.push(previewCommand);

		switch (command.type) {
			case CommandType.UserScript: {
				const script = command as IUserScript;
				walk.flags.add("user-script");
				Object.assign(previewCommand, {
					flag: "user-script",
					scriptPath: script.path,
				});
				if (script.path) {
					// Keyed like the bundled asset: the path import writes and
					// rewrites the command to.
					walk.usages.push({
						choiceId: walk.choiceId,
						path: normalizeVaultPath(script.path),
						asScript: true,
						impliedKind: "user-script",
						breadcrumb: joinCrumb(commandCrumbs),
					});
					walk.rows.push({
						flag: "user-script",
						severity: "critical",
						title: "Runs custom JavaScript with full access to your vault and the network",
						detail: crumbWithScriptPath(commandCrumbs, label, script.path),
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
				Object.assign(previewCommand, {
					flag: isScript ? "conditional-script" : undefined,
					scriptPath: isScript ? condition.scriptPath : undefined,
					summary,
				});
				if (isScript) {
					const scriptPath = (condition as { scriptPath: string }).scriptPath;
					walk.flags.add("conditional-script");
					walk.usages.push({
						choiceId: walk.choiceId,
						path: normalizeVaultPath(scriptPath),
						asScript: true,
						impliedKind: "conditional-script",
						breadcrumb: joinCrumb(commandCrumbs),
					});
					walk.rows.push({
						flag: "conditional-script",
						severity: "critical",
						title: "Runs custom JavaScript chosen by a condition",
						detail: crumbWithScriptPath(commandCrumbs, label, scriptPath),
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
				walk.rows.push({
					flag: "obsidian-command",
					severity: "warning",
					title: "Triggers another Obsidian command",
					detail: `${joinCrumb(commandCrumbs)}${obsidian.commandId ? ` (${obsidian.commandId})` : ""
						}`,
				});
				break;
			}
			case CommandType.AIAssistant: {
				walk.flags.add("ai");
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
				break;
			}
			case CommandType.OpenFile: {
				walk.flags.add("open-file");
				const filePath = (command as IOpenFileCommand).filePath;
				if (hasInlineScript(filePath)) {
					previewCommand.flag = "user-script";
					recordInlineScript(walk, [...commandCrumbs, "file path"], filePath);
				}
				break;
			}
			case CommandType.Choice:
			case CommandType.Wait: {
				break;
			}
			default: {
				previewCommand.type = String(command.type);
				if (!KNOWN_COMMAND_TYPES.has(String(command.type))) {
					walk.flags.add("unknown-command");
					previewCommand.flag = "unknown-command";
					walk.rows.push({
						flag: "unknown-command",
						severity: "warning",
						title: "Unknown capability. Review it manually.",
						detail: `${joinCrumb(commandCrumbs)} (${String(command.type)})`,
					});
				}
				break;
			}
		}
	}
}
