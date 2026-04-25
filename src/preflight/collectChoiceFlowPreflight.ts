import type { App, TFile } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../constants";
import {
	createDiagnostic,
	type ChoiceExecutionDiagnostic,
} from "../engine/runtime";
import { getIntegrationRegistry } from "../integrations/IntegrationRegistry";
import type QuickAdd from "../main";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type IChoice from "../types/choices/IChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { IConditionalCommand } from "../types/macros/Conditional/IConditionalCommand";
import { CommandType } from "../types/macros/CommandType";
import type { IChoiceCommand } from "../types/macros/IChoiceCommand";
import type { ICommand } from "../types/macros/ICommand";
import type { INestedChoiceCommand } from "../types/macros/QuickCommands/INestedChoiceCommand";
import {
	collectChoiceRequirements,
	getUnresolvedRequirements,
} from "./collectChoiceRequirements";
import type { FieldRequirement } from "./RequirementCollector";

export interface ChoiceFlowPreflightChoiceSummary {
	id: string;
	name: string;
	type: IChoice["type"];
	path: string;
	depth: number;
}

export interface ChoiceFlowPreflightResult {
	requirements: FieldRequirement[];
	unresolvedRequirements: FieldRequirement[];
	diagnostics: ChoiceExecutionDiagnostic[];
	choices: ChoiceFlowPreflightChoiceSummary[];
}

export async function collectChoiceFlowPreflight(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: IChoice,
): Promise<ChoiceFlowPreflightResult> {
	const requirementsById = new Map<string, FieldRequirement>();
	const diagnostics: ChoiceExecutionDiagnostic[] = [];
	const choices: ChoiceFlowPreflightChoiceSummary[] = [];
	const visited = new Set<string>();

	const visitChoice = async (
		currentChoice: IChoice,
		path: string[],
		depth: number,
	) => {
		const key = currentChoice.id || path.join("/");
		if (visited.has(key)) {
			diagnostics.push(
				createDiagnostic({
					severity: "warning",
					code: "flow-cycle-skipped",
					message: `Skipping already visited choice '${currentChoice.name}' during flow preflight.`,
					source: "choice",
					choiceId: currentChoice.id,
					details: { path: path.join(" / ") },
				}),
			);
			return;
		}

		visited.add(key);
		choices.push({
			id: currentChoice.id,
			name: currentChoice.name,
			type: currentChoice.type,
			path: path.join(" / "),
			depth,
		});

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			currentChoice,
		);
		for (const requirement of requirements) {
			if (!requirementsById.has(requirement.id)) {
				requirementsById.set(requirement.id, requirement);
			}
		}

		await addIntegrationDiagnostics(
			app,
			currentChoice,
			diagnostics,
		);

		if (currentChoice.type !== "Macro") return;

		diagnostics.push(
			createDiagnostic({
				severity: "info",
				code: "flow-shared-context",
				message:
					"Macro commands and nested choices share one execution context, variable map, and origin leaf.",
				source: "runtime",
				choiceId: currentChoice.id,
				details: { path: path.join(" / ") },
			}),
		);

		await visitCommands(
			(currentChoice as IMacroChoice).macro?.commands ?? [],
			path,
			depth,
		);
	};

	const visitCommands = async (
		commands: ICommand[],
		path: string[],
		depth: number,
	) => {
		for (const command of commands) {
			if (command?.type === CommandType.NestedChoice) {
				const nested = (command as INestedChoiceCommand).choice;
				if (!nested) {
					addMissingNestedChoiceDiagnostic(diagnostics, command);
					continue;
				}
				diagnostics.push(createNestedChoiceDiagnostic(command, nested));
				await visitChoice(nested, [...path, nested.name], depth + 1);
				continue;
			}

			if (command?.type === CommandType.Choice) {
				const choiceCommand = command as IChoiceCommand;
				const nested = resolveChoiceById(
					plugin,
					choiceCommand.choiceId,
					diagnostics,
					command,
				);
				if (!nested) continue;
				diagnostics.push(createNestedChoiceDiagnostic(command, nested));
				await visitChoice(nested, [...path, nested.name], depth + 1);
				continue;
			}

			if (command?.type === CommandType.Conditional) {
				const conditional = command as IConditionalCommand;
				await visitCommands(
					conditional.thenCommands ?? [],
					[...path, `${command.name} then`],
					depth,
				);
				await visitCommands(
					conditional.elseCommands ?? [],
					[...path, `${command.name} else`],
					depth,
				);
			}
		}
	};

	await visitChoice(choice, [choice.name], 0);

	const requirements = Array.from(requirementsById.values());
	const unresolvedRequirements = getUnresolvedRequirements(
		requirements,
		choiceExecutor.variables,
	);

	if (unresolvedRequirements.length > 0) {
		diagnostics.push(
			createDiagnostic({
				severity: "error",
				code: "missing-required-inputs",
				message: `${unresolvedRequirements.length} required input(s) are missing for this flow.`,
				source: "runtime",
				choiceId: choice.id,
				details: {
					missingIds: unresolvedRequirements.map(
						(requirement) => requirement.id,
					),
				},
			}),
		);
	}

	return {
		requirements,
		unresolvedRequirements,
		diagnostics,
		choices,
	};
}

function resolveChoiceById(
	plugin: QuickAdd,
	choiceId: string,
	diagnostics: ChoiceExecutionDiagnostic[],
	command: ICommand,
): IChoice | null {
	try {
		const choice = plugin.getChoiceById(choiceId);
		if (choice) return choice;
	} catch (error) {
		addChoiceCommandNotFoundDiagnostic(
			diagnostics,
			choiceId,
			command,
			error,
		);
		return null;
	}

	addChoiceCommandNotFoundDiagnostic(diagnostics, choiceId, command);
	return null;
}

function addChoiceCommandNotFoundDiagnostic(
	diagnostics: ChoiceExecutionDiagnostic[],
	choiceId: string,
	command: ICommand,
	cause?: unknown,
): void {
	diagnostics.push(
		createDiagnostic({
			severity: "warning",
			code: "nested-choice-not-found",
			message: `Nested choice '${choiceId}' referenced by '${command.name}' could not be found.`,
			source: "command",
			stepId: command.id,
			details: { choiceId, commandName: command.name },
			cause,
		}),
	);
}

function addMissingNestedChoiceDiagnostic(
	diagnostics: ChoiceExecutionDiagnostic[],
	command: ICommand,
): void {
	diagnostics.push(
		createDiagnostic({
			severity: "warning",
			code: "nested-choice-not-found",
			message: `Nested choice command '${command.name}' has no choice configured.`,
			source: "command",
			stepId: command.id,
			details: { commandName: command.name },
		}),
	);
}

function createNestedChoiceDiagnostic(
	command: ICommand,
	choice: IChoice,
): ChoiceExecutionDiagnostic {
	return createDiagnostic({
		severity: "info",
		code: "nested-choice-shares-context",
		message: `Nested choice '${choice.name}' will reuse the parent flow context.`,
		source: "command",
		stepId: command.id,
		choiceId: choice.id,
		details: {
			commandName: command.name,
			choiceType: choice.type,
		},
	});
}

async function addIntegrationDiagnostics(
	app: App,
	choice: IChoice,
	diagnostics: ChoiceExecutionDiagnostic[],
): Promise<void> {
	const templaterUsage = await getTemplaterUsage(app, choice);
	if (!templaterUsage.usesTemplater) return;

	const templater = getIntegrationRegistry(app).templater;
	const report = templater.getCapabilityReport();
	if (!report.installed) {
		diagnostics.push(
			createDiagnostic({
				severity: "info",
				code: "templater-not-installed",
				message:
					"Templater syntax or policy was detected, but Templater is not installed. QuickAdd will skip Templater operations.",
				source: "integration",
				choiceId: choice.id,
				integrationId: report.pluginId,
				details: templaterUsage,
			}),
		);
		return;
	}

	const missing = templaterUsage.requiredCapabilities.filter(
		(capability) => !templater.hasCapability(capability),
	);
	if (missing.length === 0) return;

	diagnostics.push(
		createDiagnostic({
			severity: "warning",
			code: "templater-capabilities-missing",
			message: `Templater is missing optional capability/capabilities: ${missing.join(", ")}.`,
			source: "integration",
			choiceId: choice.id,
			integrationId: report.pluginId,
			details: { ...templaterUsage, missingCapabilities: missing },
		}),
	);
}

async function getTemplaterUsage(
	app: App,
	choice: IChoice,
): Promise<{
	usesTemplater: boolean;
	requiredCapabilities: Array<
		"overwriteFileCommands" | "parseTemplate" | "triggerOnFileCreation"
	>;
	reason: string;
}> {
	if (choice.type === "Template") {
		const content = await readTemplate(app, (choice as ITemplateChoice).templatePath);
		return {
			usesTemplater: content.includes("<%"),
			requiredCapabilities: ["overwriteFileCommands"],
			reason: "template-content",
		};
	}

	if (choice.type === "Capture") {
		const capture = choice as ICaptureChoice;
		const captureFormat = capture.format?.enabled ? capture.format.format : "";
		const templateContent = capture.createFileIfItDoesntExist?.createWithTemplate
			? await readTemplate(app, capture.createFileIfItDoesntExist.template)
			: "";
		const afterCaptureWholeFile =
			capture.templater?.afterCapture === "wholeFile";
		return {
			usesTemplater:
				captureFormat.includes("<%") ||
				templateContent.includes("<%") ||
				afterCaptureWholeFile,
			requiredCapabilities: [
				"parseTemplate",
				...(templateContent.includes("<%") || afterCaptureWholeFile
					? (["overwriteFileCommands"] as const)
					: []),
				...(capture.createFileIfItDoesntExist?.enabled &&
				!capture.createFileIfItDoesntExist.createWithTemplate
					? (["triggerOnFileCreation"] as const)
					: []),
			],
			reason: afterCaptureWholeFile
				? "capture-after-whole-file"
				: "capture-content",
		};
	}

	return {
		usesTemplater: false,
		requiredCapabilities: [],
		reason: "not-applicable",
	};
}

async function readTemplate(app: App, path: string): Promise<string> {
	if (!path) return "";
	const addExt =
		!MARKDOWN_FILE_EXTENSION_REGEX.test(path) &&
		!CANVAS_FILE_EXTENSION_REGEX.test(path) &&
		!BASE_FILE_EXTENSION_REGEX.test(path);
	const normalized = addExt ? `${path}.md` : path;
	const file = app.vault.getAbstractFileByPath(normalized);
	if (file instanceof ObsidianTFile) {
		return await app.vault.cachedRead(file as TFile);
	}
	return "";
}
