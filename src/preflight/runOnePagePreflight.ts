import type { App } from "obsidian";
import { TFile } from "obsidian";
import { MARKDOWN_FILE_EXTENSION_REGEX, QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "src/constants";
import { FormatDisplayFormatter } from "src/formatters/formatDisplayFormatter";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type QuickAdd from "src/main";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IChoice from "src/types/choices/IChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { ICommand } from "src/types/macros/ICommand";
import type { IUserScript } from "src/types/macros/IUserScript";
import {
	getMarkdownFilesInFolder,
	getMarkdownFilesWithTag,
	getUserScript,
	isFolder,
} from "src/utilityObsidian";
import { parseNaturalLanguageDate } from "src/utils/dateParser";
import { OnePageInputModal } from "./OnePageInputModal";
import {
	type FieldRequirement,
	RequirementCollector,
} from "./RequirementCollector";

async function readTemplate(app: App, path: string): Promise<string> {
	const addExt =
		!MARKDOWN_FILE_EXTENSION_REGEX.test(path) && !path.endsWith(".canvas");
	const normalized = addExt ? `${path}.md` : path;
	const f = app.vault.getAbstractFileByPath(normalized);
	if (f instanceof TFile) {
		return await app.vault.cachedRead(f);
	}
	return "";
}

async function collectForTemplateChoice(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: ITemplateChoice,
) {
	const collector = new RequirementCollector(app, plugin, choiceExecutor);

	// File name format
	if (choice.fileNameFormat?.enabled) {
		await collector.scanString(choice.fileNameFormat.format);
	}

	// Folder paths that may contain variables
	if (choice.folder?.enabled) {
		for (const folder of choice.folder.folders ?? []) {
			await collector.scanString(folder);
		}
	}

	// Template content + nested templates
	if (choice.templatePath) {
		const visited = new Set<string>();
		const walk = async (path: string) => {
			if (visited.has(path)) return;
			visited.add(path);
			const content = await readTemplate(app, path);
			await collector.scanString(content);
			for (const nested of collector.templatesToScan) {
				if (!visited.has(nested)) await walk(nested);
			}
			collector.templatesToScan.clear();
		};
		await walk(choice.templatePath);
	}

	return collector;
}

async function collectForCaptureChoice(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: ICaptureChoice,
) {
	const collector = new RequirementCollector(app, plugin, choiceExecutor);

	// captureTo can contain variables / tags / folders
	await collector.scanString(choice.captureTo);

	// Content
	if (choice.format?.enabled) {
		await collector.scanString(choice.format.format);
	}

	// If captureTo indicates a folder or tag, offer a file picker requirement
	const formattedTarget = choice.captureTo?.trim() ?? "";
	const isTagTarget = formattedTarget.startsWith("#");
	const trimmedPath = formattedTarget.replace(/\/$|\.md$/g, "");
	const isFolderTarget =
		!isTagTarget && (formattedTarget === "" || isFolder(app, trimmedPath));
	// Heuristics: if target ends with '/' or contains unresolved tokens, we likely need a picker
	const looksLikeFolderBySuffix = formattedTarget.endsWith("/");
	const containsFormatTokens = /{{[^}]+}}/.test(choice.captureTo ?? "");

	if (
		!choice.captureToActiveFile &&
		(isTagTarget ||
			isFolderTarget ||
			looksLikeFolderBySuffix ||
			containsFormatTokens)
	) {
		let files: TFile[] = [];
		if (isTagTarget) {
			files = getMarkdownFilesWithTag(app, formattedTarget);
		} else {
			const folder = formattedTarget.replace(/^\/$|\/\.md$|^\.md$/, "");
			const base =
				folder === "" ? "" : folder.endsWith("/") ? folder : `${folder}/`;
			files = getMarkdownFilesInFolder(app, base);
		}

		const options = files.map((f) => f.path);
        collector.requirements.set(QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, {
            id: QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			label: "Select capture target file",
			type: "dropdown",
			options,
			placeholder: options.length
				? undefined
				: "No files found in target scope",
		});
	}

	return collector;
}

export async function runOnePagePreflight(
	app: App,
	plugin: QuickAdd,
	choiceExecutor: IChoiceExecutor,
	choice: IChoice,
): Promise<boolean> {
	try {
		let collector: RequirementCollector | null = null;
		const scriptRequirements: FieldRequirement[] = [];

		if (choice.type === "Template") {
			collector = await collectForTemplateChoice(
				app,
				plugin,
				choiceExecutor,
				choice as ITemplateChoice,
			);
		} else if (choice.type === "Capture") {
			collector = await collectForCaptureChoice(
				app,
				plugin,
				choiceExecutor,
				choice as ICaptureChoice,
			);
		} else if (choice.type === "Macro") {
			// Phase 2 (limited): Collect declared inputs from user scripts in the macro
			const macro = choice as IMacroChoice;
			const commands: ICommand[] = macro?.macro?.commands ?? [];
			for (const cmd of commands) {
				if (cmd?.type === CommandType.UserScript) {
					const us = cmd as IUserScript;
					try {
						const exported = await getUserScript(us, app);
						// We will not execute script functions. Accept both function and object exports.
						const spec =
							exported && typeof exported === "object" && "quickadd" in exported
								? (exported as any).quickadd
								: typeof exported === "function" && (exported as any).quickadd
									? (exported as any).quickadd
									: null;
						if (spec?.inputs && Array.isArray(spec.inputs)) {
							for (const input of spec.inputs) {
								if (!input?.id || !input?.type) continue;
								const req: FieldRequirement = {
									id: String(input.id),
									label: String(input.label ?? input.id),
									type: input.type,
									placeholder: input.placeholder,
									defaultValue: input.defaultValue,
									options: input.options,
									dateFormat: input.dateFormat,
								};
								scriptRequirements.push(req);
							}
						}
					} catch {
						// Ignore script spec errors silently in preflight
					}
				}
			}
		} else {
			return false; // Phase 1 handles Template & Capture only
		}

		// Combine formatter-collected requirements with script-declared ones (if any)
		const mergedMap = new Map<string, FieldRequirement>();
		for (const r of collector
			? Array.from(collector.requirements.values())
			: [])
			mergedMap.set(r.id, r);
		for (const r of scriptRequirements)
			if (!mergedMap.has(r.id)) mergedMap.set(r.id, r);
		const requirements: FieldRequirement[] = Array.from(mergedMap.values());
		if (requirements.length === 0) return false; // Nothing to collect

		// Only prompt for unresolved inputs (variables missing or null). Empty string is intentional.
		const unresolved: FieldRequirement[] = requirements.filter((req) => {
			const v = choiceExecutor.variables.get(req.id) as unknown;
			return v === undefined || v === null;
		});

		if (unresolved.length === 0) return false; // Everything prefilled, skip modal

		// Show modal
		// Optional live preview of a couple of key outputs (best-effort)
		const computePreview = async (values: Record<string, string>) => {
			try {
				const formatter = new FormatDisplayFormatter(app, plugin);
				const out: Record<string, string> = {};
				// File name preview for Template
				if (choice.type === "Template") {
					const tmpl = choice as ITemplateChoice;
					if (tmpl.fileNameFormat?.enabled) {
						// Seed variables map-like into formatter
						for (const [k, v] of Object.entries(values)) {
							formatter["variables"].set(k, v);
						}
						out.fileName = await formatter.format(tmpl.fileNameFormat.format);
					}
				}
				return out;
			} catch {
				return {};
			}
		};

		const modal = new OnePageInputModal(
			app,
			unresolved,
			choiceExecutor.variables,
			computePreview,
		);
		const values = await modal.waitForClose;

		// No additional normalization needed: date inputs already store @date:ISO

		// Store results into executor variables
		Object.entries(values).forEach(([k, v]) =>
			choiceExecutor.variables.set(k, v),
		);

		return true;
	} catch {
		return false;
	}
}
