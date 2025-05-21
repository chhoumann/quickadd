import type {
	App,
	TAbstractFile,
	WorkspaceLeaf,
	CachedMetadata,
} from "obsidian";
import { FileView, MarkdownView, TFile, TFolder } from "obsidian";
import type { NewTabDirection } from "./types/newTabDirection";
import type { IUserScript } from "./types/macros/IUserScript";
import type { FileViewMode } from "./types/fileViewMode";
import type { TemplateChoice } from "./types/choices/TemplateChoice";
import type { MultiChoice } from "./types/choices/MultiChoice";
import type { CaptureChoice } from "./types/choices/CaptureChoice";
import type { MacroChoice } from "./types/choices/MacroChoice";
import type IChoice from "./types/choices/IChoice";
import { log } from "./logger/logManager";

export function getTemplater(app: App) {
	return app.plugins.plugins["templater-obsidian"];
}

export async function replaceTemplaterTemplatesInCreatedFile(
	app: App,
	file: TFile,
	force = false,
) {
	const templater = getTemplater(app);
	
	if (!templater) return;
	
	// Process Templater commands in these cases:
	// 1. force=true (explicitly requested processing, e.g., for Template choices)
	// 2. Templater's trigger_on_file_creation=false (manual processing required)
	const shouldProcess = force || 
		!(templater.settings as Record<string, unknown>)["trigger_on_file_creation"];
	
	if (shouldProcess) {
		const impl = templater?.templater as {
			overwrite_file_commands?: (file: TFile) => Promise<void>;
		};
		if (impl?.overwrite_file_commands) {
			await impl.overwrite_file_commands(file);
		}
	}
}

export async function templaterParseTemplate(
	app: App,
	templateContent: string,
	targetFile: TFile,
) {
	const templater = getTemplater(app);
	if (!templater) return templateContent;

	return await (
		templater.templater as {
			parse_template: (
				opt: { target_file: TFile; run_mode: number },
				content: string,
			) => Promise<string>;
		}
	).parse_template({ target_file: targetFile, run_mode: 4 }, templateContent);
}

export function getNaturalLanguageDates(app: App) {
	// @ts-ignore
	return app.plugins.plugins["nldates-obsidian"];
}

export function getDate(input?: { format?: string; offset?: number }) {
	let duration;

	if (
		input?.offset !== null &&
		input?.offset !== undefined &&
		typeof input.offset === "number"
	) {
		duration = window.moment.duration(input.offset, "days");
	}

	return input?.format
		? window.moment().add(duration).format(input.format)
		: window.moment().add(duration).format("YYYY-MM-DD");
}

export function appendToCurrentLine(toAppend: string, app: App) {
	try {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);

		if (!activeView) {
			log.logError(`unable to append '${toAppend}' to current line.`);
			return;
		}

		activeView.editor.replaceSelection(toAppend);
	} catch {
		log.logError(`unable to append '${toAppend}' to current line.`);
	}
}

export function findObsidianCommand(app: App, commandId: string) {
	return app.commands.findCommand(commandId);
}

export function deleteObsidianCommand(app: App, commandId: string) {
	if (findObsidianCommand(app, commandId)) {
		delete app.commands.commands[commandId];
		delete app.commands.editorCommands[commandId];
	}
}

export function getAllFolderPathsInVault(app: App): string[] {
	return app.vault
		.getAllLoadedFiles()
		.filter((f) => f instanceof TFolder)
		.map((folder) => folder.path);
}

export function getUserScriptMemberAccess(fullMemberPath: string): {
	basename: string | undefined;
	memberAccess: string[] | undefined;
} {
	const fullMemberArray: string[] = fullMemberPath.split("::");
	return {
		basename: fullMemberArray[0],
		memberAccess: fullMemberArray.slice(1),
	};
}

export async function openFile(
	app: App,
	file: TFile,
	optional: {
		openInNewTab?: boolean;
		direction?: NewTabDirection;
		mode?: FileViewMode;
		focus?: boolean;
	},
) {
	let leaf: WorkspaceLeaf;

	if (optional.openInNewTab && optional.direction) {
		leaf = app.workspace.getLeaf("split", optional.direction);
	} else {
		leaf = app.workspace.getLeaf("tab");
	}

	await leaf.openFile(file);

	if (optional?.focus) {
		app.workspace.setActiveLeaf(leaf, { focus: optional.focus });
	}

	if (optional?.mode) {
		const leafViewState = leaf.getViewState();

		await leaf.setViewState({
			...leafViewState,
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
			state: {
				...leafViewState.state,
				mode: optional.mode,
			},
		});
	}
}

/**
 * If there is no existing tab which opened the file, return false, else return true.
 */
export function openExistingFileTab(
	app: App,
	file: TFile,
): boolean {
	let leaf: WorkspaceLeaf | undefined = undefined;

	app.workspace.iterateRootLeaves((m_leaf: WorkspaceLeaf) => {
		const view = m_leaf.view;
		if (view instanceof FileView) {
			if (view.file) {
				if (file.path === view.file.path) {
					leaf = m_leaf;
					return;
				}
			}
		}
	});
	if (leaf !== undefined) {
		app.workspace.setActiveLeaf(leaf);
		return true;
	}
	return false;
}

// Slightly modified version of Templater's user script import implementation
// Source: https://github.com/SilentVoid13/Templater
export async function getUserScript(command: IUserScript, app: App) {
	// @ts-ignore
	const file: TAbstractFile = app.vault.getAbstractFileByPath(command.path);
	if (!file) {
		log.logError(`failed to load file ${command.path}.`);
		return;
	}

	if (file instanceof TFile) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		const req = (s: string) => window.require && window.require(s);
		const exp: Record<string, unknown> = {};
		const mod = { exports: exp };

		const fileContent = await app.vault.read(file);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		const fn = window.eval(
			`(function(require, module, exports) { ${fileContent} \n})`,
		);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-call
		fn(req, mod, exp);

		// @ts-ignore
		const userScript = exp["default"] || mod.exports;
		if (!userScript) return;

		let script = userScript;

		const { memberAccess } = getUserScriptMemberAccess(command.name);
		if (memberAccess && memberAccess.length > 0) {
			let member: string;
			while ((member = memberAccess.shift() as string)) {
				//@ts-ignore
				// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
				script = script[member];
			}
		}

		return script;
	}
}

export function excludeKeys<T extends object, K extends keyof T>(
	sourceObj: T,
	except: K[],
): Omit<T, K> {
	const obj = structuredClone(sourceObj);

	for (const key of except) {
		delete obj[key];
	}

	return obj;
}

export function getChoiceType<
	T extends TemplateChoice | MultiChoice | CaptureChoice | MacroChoice,
>(choice: IChoice): choice is T {
	const isTemplate = (choice: IChoice): choice is TemplateChoice =>
		choice.type === "Template";
	const isMacro = (choice: IChoice): choice is MacroChoice =>
		choice.type === "Macro";
	const isCapture = (choice: IChoice): choice is CaptureChoice =>
		choice.type === "Capture";
	const isMulti = (choice: IChoice): choice is MultiChoice =>
		choice.type === "Multi";

	return (
		isTemplate(choice) ||
		isMacro(choice) ||
		isCapture(choice) ||
		isMulti(choice)
	);
}

export function isFolder(path: string, app: App): boolean {
	const abstractItem = app.vault.getAbstractFileByPath(path);

	return !!abstractItem && abstractItem instanceof TFolder;
}

export function getMarkdownFilesInFolder(folderPath: string, app: App): TFile[] {
	return app.vault
		.getMarkdownFiles()
		.filter((f: TFile) => f.path.startsWith(folderPath));
}

function getFrontmatterTags(fileCache: CachedMetadata): string[] {
	const frontmatter = fileCache.frontmatter;
	if (!frontmatter) return [];

	// You can have both a 'tag' and 'tags' key in frontmatter.
	const frontMatterValues = Object.entries(frontmatter);
	if (!frontMatterValues.length) return [];

	const tagPairs = frontMatterValues.filter(([key, value]) => {
		const lowercaseKey = key.toLowerCase();

		// In Obsidian, these are synonymous.
		return lowercaseKey === "tags" || lowercaseKey === "tag";
	});

	if (!tagPairs) return [];

	const tags = tagPairs
		.flatMap(([key, value]) => {
			if (typeof value === "string") {
				// separator can either be comma or space separated
				return value.split(/,|\s+/).map((v) => v.trim());
			} else if (Array.isArray(value)) {
				return value as string[];
			}
		})
		.filter((v) => !!v) as string[]; // fair to cast after filtering out falsy values

	return tags;
}

function getFileTags(file: TFile, app: App): string[] {
	const fileCache = app.metadataCache.getFileCache(file);
	if (!fileCache) return [];

	const tagsInFile: string[] = [];
	if (fileCache.frontmatter) {
		tagsInFile.push(...getFrontmatterTags(fileCache));
	}

	if (fileCache.tags && Array.isArray(fileCache.tags)) {
		tagsInFile.push(...fileCache.tags.map((v: any) => v.tag.replace(/^\#/, "")));
	}

	return tagsInFile;
}

export function getMarkdownFilesWithTag(tag: string, app: App): TFile[] {
	const targetTag = tag.replace(/^\#/, "");

	return app.vault.getMarkdownFiles().filter((f: TFile) => {
		const fileTags = getFileTags(f, app);

		return fileTags.includes(targetTag);
	});
}
