import type { App, TFile } from "obsidian";
import { getMarkdownFilesInFolder, getMarkdownFilesMatchingFilter, getMarkdownFilesWithProperty, getMarkdownFilesWithTag } from "../../utils/vaultQueries";
import { orderFilesForPicker } from "../../utils/fileOrdering";
import { buildPickerOrderingDeps } from "../../utils/pickerOrderingDeps";
import { buildFileDisplayInfos } from "../../utils/fileSyntax";
import type { CaptureTargetScope } from "./captureTargetScope";

export function captureScopeFiles(app: App, scope: CaptureTargetScope): TFile[] {
	switch (scope.kind) {
		case "filter": return getMarkdownFilesMatchingFilter(app, scope.filter);
		case "property": return getMarkdownFilesWithProperty(app, scope.field, scope.value, scope.filter);
		case "tag": return getMarkdownFilesWithTag(app, scope.tag);
		case "folder": return getMarkdownFilesInFolder(app, scope.folderPathSlash);
	}
}

export function captureCandidates(app: App, files: TFile[]) {
	const ordered = orderFilesForPicker(files, buildPickerOrderingDeps(app));
	const paths = ordered.map((file) => file.path);
	const infos = buildFileDisplayInfos(ordered, (file) => app.metadataCache.getFileCache(file));
	const labels = infos.map((info) => info.label);
	const aliases = infos.map((info) => info.aliases);
	// Search what a row shows, its title and its path, so every match can be
	// highlighted. The path holds the rest of the label (file name, folder).
	const search = paths.map((path, index) => `${infos[index]?.primary ?? path} ${path}`);
	return { paths, labels, aliases, search };
}
