import type { App, TFile } from "obsidian";
import { getFrontMatterInfo, parseYaml } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import {
	getMarkdownEditorViewForFile,
	templaterParseTemplate,
} from "../utilityObsidian";
import { assignFrontmatterValue } from "./helpers/frontmatterPostProcessor";
import invariant from "../utils/invariant";
import { TemplatePropertyCollector } from "../utils/TemplatePropertyCollector";
import { coerceYamlValue } from "../utils/yamlValues";
import { parentFolderPath } from "../utils/pathUtils";
import { insertAtNoteBodyStart } from "../utils/noteContentInsertion";
import { TemplateEngine } from "./TemplateEngine";

export const templateInsertModes = [
	{
		id: "cursor",
		label: "Insert at cursor",
		description: "Inserts the template at the cursor position in the editor.",
	},
	{
		id: "top",
		label: "Insert at top",
		description:
			"Inserts the template below the note's frontmatter, or at the very top.",
	},
	{
		id: "bottom",
		label: "Append to bottom",
		description: "Adds the template content to the end of the note.",
	},
	{
		id: "replace",
		label: "Replace note content",
		description: "Replaces the entire note content with the template.",
	},
] as const;

export type TemplateInsertModeId = (typeof templateInsertModes)[number]["id"];

export function isTemplateInsertMode(
	value: unknown,
): value is TemplateInsertModeId {
	return templateInsertModes.some((mode) => mode.id === value);
}

/**
 * Splits formatted template content into its YAML frontmatter (without
 * delimiters) and the remaining body.
 */
export function splitTemplateFrontmatter(content: string): {
	frontmatterYaml: string | null;
	body: string;
} {
	const info = getFrontMatterInfo(content);
	if (!info.exists) return { frontmatterYaml: null, body: content };

	return {
		frontmatterYaml: info.frontmatter,
		body: content.slice(info.contentStart),
	};
}

/**
 * Inserts a template body into existing note content. "top" is
 * frontmatter-aware: the body lands below the note's frontmatter block.
 *
 * The "top" branch reuses the shared, fence-safe `insertAtNoteBodyStart`
 * (src/utils/noteContentInsertion.ts). Appending a newline to the body expresses
 * the template-apply policy that the inserted block always ends on its own line —
 * leaving a blank-line separation from the existing content when the body itself
 * already ends in a newline. (Capture callers use the same primitive WITHOUT the
 * extra newline, for tight single-snippet insertion.)
 */
export function insertBodyIntoNoteContent(
	noteContent: string,
	body: string,
	position: "top" | "bottom",
): string {
	if (position === "bottom") {
		return `${noteContent}\n${body}`;
	}

	return insertAtNoteBodyStart(noteContent, `${body}\n`);
}

/**
 * Applies a template to an existing note (issue #526). Unlike
 * TemplateChoiceEngine, this never creates a file: it inserts, prepends,
 * appends, or replaces content in the target note. Top/bottom/cursor modes
 * merge the template's frontmatter properties into the note's existing
 * frontmatter, with existing values winning.
 */
export class TemplateInsertEngine extends TemplateEngine {
	constructor(
		app: App,
		plugin: QuickAdd,
		private readonly targetFile: TFile,
		private readonly templatePath: string,
		private readonly mode: TemplateInsertModeId,
		choiceExecutor?: IChoiceExecutor,
	) {
		super(app, plugin, choiceExecutor);
	}

	private resolvedTemplatePath: string | null = null;

	public async run(): Promise<void> {
		await this.apply();
	}

	/**
	 * Resolves the template path's format tokens (issue #620) once and memoizes
	 * the result: apply() and computeChoiceTargetPath() run on the same engine
	 * instance, and re-resolving would re-evaluate {{date}}/{{random}} (and
	 * re-prompt). Exposed so applyTemplateToNote can re-validate the resolved
	 * extension before applying.
	 */
	public async getResolvedTemplatePath(): Promise<string> {
		if (this.resolvedTemplatePath === null) {
			this.resolvedTemplatePath = await this.resolveTemplateSourcePath(
				this.templatePath,
			);
		}
		return this.resolvedTemplatePath;
	}

	public async apply(): Promise<TFile | null> {
		invariant(
			this.templatePath,
			"Cannot apply template: no template path given.",
		);

		switch (this.mode) {
			case "replace":
				return await this.overwriteFileWithTemplate(
					this.targetFile,
					await this.getResolvedTemplatePath(),
				);
			case "top":
			case "bottom":
				return await this.insertTemplateIntoFile(this.mode);
			case "cursor":
				return await this.insertTemplateAtCursor();
		}
	}

	/**
	 * Computes the file path the given Template choice would have produced,
	 * for offering to move/rename the note to match the choice's settings.
	 * Returns null when the choice's folder configuration requires a runtime
	 * picker (cannot be resolved non-interactively).
	 */
	public async computeChoiceTargetPath(
		choice: ITemplateChoice,
	): Promise<string | null> {
		const folderSettings = choice.folder;
		let folderPath: string;

		// This engine's formatter was already used by apply() with the note's
		// own folder as the {{FOLDER}} target. Clear it so folder-definition
		// formatting below treats {{FOLDER}} as self-referential (empty) rather
		// than inheriting that stale value.
		this.formatter.setTargetFolderPath(null);

		if (folderSettings?.enabled) {
			if (
				folderSettings.chooseWhenCreatingNote ||
				folderSettings.chooseFromSubfolders
			) {
				return null;
			}

			if (folderSettings.createInSameFolderAsActiveFile) {
				folderPath = this.targetFile.parent?.path ?? "";
			} else if (folderSettings.folders.length === 1) {
				folderPath = await this.formatter.formatFolderPath(
					folderSettings.folders[0],
				);
			} else {
				return null;
			}
		} else {
			folderPath = this.targetFile.parent?.path ?? "";
		}

		if (folderPath === "/") folderPath = "";

		let fileName = this.targetFile.basename;
		let treatAsVaultRelativePath = false;
		if (choice.fileNameFormat?.enabled && choice.fileNameFormat.format) {
			// The file name's {{FOLDER}} reflects the folder this choice would
			// create the note in (the path just computed), matching what
			// TemplateChoiceEngine produces.
			this.formatter.setTargetFolderPath(folderPath);
			const formattedName = await this.formatter.formatFileName(
				choice.fileNameFormat.format,
				choice.name,
			);
			// Mirror TemplateChoiceEngine's resolution of formatted names that
			// contain folders, so the move offer matches what the choice
			// would actually have produced.
			const stripped = this.stripDuplicateFolderPrefix(
				formattedName,
				folderPath,
			);
			fileName = stripped.fileName;
			treatAsVaultRelativePath =
				this.shouldTreatFormattedNameAsVaultRelativePath(
					formattedName,
					stripped.strippedPrefix,
					folderSettings?.enabled ?? false,
				);
		}

		// An all-optional file name format can resolve empty (or to a
		// trailing slash with no leaf segment); there is no meaningful move
		// offer in that case (and normalizeTemplateFilePath rejects empty
		// basenames).
		if (!fileName.slice(fileName.lastIndexOf("/") + 1).trim()) return null;

		// Invariant: this engine is always constructed with the same choice's
		// templatePath that callers pass here (see applyTemplateToNote), so the
		// memoized resolved path matches `choice`. The extension therefore comes
		// from the resolved source path (issue #620), consistent with apply().
		return this.normalizeTemplateFilePath(
			treatAsVaultRelativePath ? "" : folderPath,
			fileName,
			await this.getResolvedTemplatePath(),
		);
	}

	private async insertTemplateIntoFile(
		position: "top" | "bottom",
	): Promise<TFile> {
		const { formatted, templatePropertyVars } =
			await this.formatTemplateForTargetFile();
		const { frontmatterYaml, body } = splitTemplateFrontmatter(formatted);

		if (body.trim().length > 0) {
			// vault.process is Obsidian's atomic read-modify-write; the docs recommend
			// it over read+modify, and it reads fresh from disk (unlike cachedRead).
			await this.app.vault.process(this.targetFile, (noteContent) =>
				insertBodyIntoNoteContent(noteContent, body, position),
			);
		}

		await this.mergeFrontmatterProperties(
			frontmatterYaml,
			templatePropertyVars,
		);
		return this.targetFile;
	}

	private async insertTemplateAtCursor(): Promise<TFile> {
		const view = getMarkdownEditorViewForFile(this.app, this.targetFile);
		invariant(
			view,
			"Cannot insert at cursor: the note is not open in the active editor.",
		);

		const { formatted, templatePropertyVars } =
			await this.formatTemplateForTargetFile();
		const { frontmatterYaml, body } = splitTemplateFrontmatter(formatted);

		if (body.trim().length > 0) {
			view.editor.replaceSelection(body);
		}

		await this.mergeFrontmatterProperties(
			frontmatterYaml,
			templatePropertyVars,
		);
		return this.targetFile;
	}

	private async formatTemplateForTargetFile(): Promise<{
		formatted: string;
		templatePropertyVars: Map<string, unknown>;
	}> {
		const templateContent = await this.getTemplateContent(
			await this.getResolvedTemplatePath(),
		);

		this.formatter.setTitle(this.targetFile.basename);
		// {{FOLDER}} resolves to the note's own folder when applying a template.
		this.formatter.setTargetFolderPath(parentFolderPath(this.targetFile.path));

		let formatted = await this.formatter.withTemplatePropertyCollection(() =>
			this.formatter.formatFileContent(templateContent),
		);
		const templatePropertyVars =
			this.formatter.getAndClearTemplatePropertyVars();

		if (this.targetFile.extension === "md") {
			formatted = await templaterParseTemplate(
				this.app,
				formatted,
				this.targetFile,
			);
		}

		return { formatted, templatePropertyVars };
	}

	/**
	 * Merges template frontmatter properties into the note's frontmatter via
	 * Obsidian's YAML processor. Existing note values win: only missing or
	 * empty (undefined/null/"") properties are filled from the template.
	 *
	 * Structured values (arrays/objects) collected during formatting replace
	 * their YAML placeholders before merging, so Template Property Types are
	 * preserved like in replace mode.
	 */
	private async mergeFrontmatterProperties(
		frontmatterYaml: string | null,
		templatePropertyVars?: Map<string, unknown>,
	): Promise<void> {
		if (!frontmatterYaml || this.targetFile.extension !== "md") return;

		let parsed: unknown;
		try {
			parsed = parseYaml(frontmatterYaml);
		} catch (err) {
			log.logWarning(
				`Could not parse template frontmatter for merging: ${err}`,
			);
			return;
		}

		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return;
		}

		if (templatePropertyVars && templatePropertyVars.size > 0) {
			for (const [key, value] of templatePropertyVars) {
				const pathSegments = key.includes(
					TemplatePropertyCollector.PATH_SEPARATOR,
				)
					? key.split(TemplatePropertyCollector.PATH_SEPARATOR)
					: [key];
				assignFrontmatterValue(
					parsed as Record<string, unknown>,
					pathSegments,
					coerceYamlValue(value),
				);
			}
		}

		await this.app.fileManager.processFrontMatter(
			this.targetFile,
			(frontmatter: Record<string, unknown>) => {
				for (const [key, value] of Object.entries(parsed)) {
					const existing = frontmatter[key];
					if (
						existing === undefined ||
						existing === null ||
						existing === ""
					) {
						frontmatter[key] = value;
					}
				}
			},
		);
	}
}
