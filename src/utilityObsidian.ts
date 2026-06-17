// Barrel for Obsidian-facing utility helpers.
//
// This file used to be a 1300-line "junk drawer" mixing eight unrelated
// concerns. The implementations now live in cohesive `src/utils/*` modules,
// grouped by concern; this barrel re-exports them so the established import
// surface (`from "./utilityObsidian"` / `from "src/utilityObsidian"`) keeps
// working unchanged. New code can import directly from the specific module.
//
//   - templaterIntegration  Templater plugin bridging + file-settle waits
//   - editorInsertion        cursor/link insertion in the active editor
//   - templateFolderUtils    template path/extension/folder resolution
//   - fileOpening            opening files, workspace-leaf selection, vault paths
//   - userScript             loading user scripts (.js or ```js note fences)
//   - vaultQueries           folder/file/tag lookups over the vault
//   - obsidianCommands       command-registry helpers
//   - dates                  date helpers ({{DATE}}/{{TIME}} token formatting)

export {
	type TemplaterPluginLike,
	waitForFileSettle,
	getTemplater,
	getTemplaterPlugin,
	isTemplaterTriggerOnCreateEnabled,
	waitForTemplaterTriggerOnCreateToComplete,
	withTemplaterFileCreationSuppressed,
	waitForFileToStopChanging,
	overwriteTemplaterOnce,
	templaterParseTemplate,
	jumpToNextTemplaterCursorIfPossible,
} from "./utils/templaterIntegration";

export {
	getMarkdownEditorViewForFile,
	appendToCurrentLine,
	insertOnNewLine,
	insertOnNewLineAbove,
	insertOnNewLineBelow,
	insertLinkWithPlacement,
	insertFileLinkToActiveView,
} from "./utils/editorInsertion";

export {
	DEFAULT_ADDITIONAL_TEMPLATE_SOURCE_EXTENSIONS,
	buildTemplateInclusionRegex,
	getTemplateOutputExtension,
	hasTemplateExtension,
	getTemplateFile,
	getTemplateSourceExtensions,
	normalizeTemplateFolderPaths,
	normalizeTemplateSourceExtensions,
	isPathWithinTemplateFolders,
	stripTemplateOutputExtension,
} from "./utils/templateFolderUtils";

export {
	type OpenLocation,
	type FileViewMode2,
	type OpenFileOptions,
	type OpenFileRuntimeOptions,
	getOpenFileOriginLeaf,
	openFile,
	normalizeVaultFilePath,
	areSameVaultFilePath,
	openExistingFileTab,
} from "./utils/fileOpening";

export { getUserScript, getUserScriptMemberAccess } from "./utils/userScript";

export {
	getAllFolderPathsInVault,
	isFolder,
	getMarkdownFilesInFolder,
	getMarkdownFilesWithTag,
	getMarkdownFilesWithProperty,
} from "./utils/vaultQueries";

export { findObsidianCommand, deleteObsidianCommand } from "./utils/obsidianCommands";

export { getDate } from "./utils/dates";
