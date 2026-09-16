import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { CommandType } from "../types/macros/CommandType";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import type { ConditionalCondition } from "../types/macros/Conditional/types";
import type { ICommand } from "../types/macros/ICommand";
import type { IObsidianCommand } from "../types/macros/IObsidianCommand";
import type { IUserScript } from "../types/macros/IUserScript";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import type {
	QuickAddPackage
} from "../types/packages/QuickAddPackage";
import { isChoiceLike } from "../utils/choiceUtils";
import { commandListOf, isCommandLike } from "../utils/macroUtils";

import type { CapabilityRow, PreviewCommand, PreviewFlag, PreviewUsageSite } from "../types/packages/PackagePreview";
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
		return `script: ${condition.scriptPath}${condition.exportName ? ` (${condition.exportName})` : ""
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
		collectCommands(choice.macro?.commands, walk, crumbs, entryIds, depthLevel);
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

