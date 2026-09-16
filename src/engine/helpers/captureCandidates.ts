import type { App, TFile } from "obsidian";
import { getMarkdownFilesInFolder, getMarkdownFilesMatchingFilter,
	getMarkdownFilesWithProperty, getMarkdownFilesWithTag } from "../../utilityObsidian";
import { orderFilesForPicker } from "../../utils/fileOrdering";
import { buildPickerOrderingDeps } from "../../utils/pickerOrderingDeps";
import { buildFileDisplayLabels } from "../../utils/fileSyntax";
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
	const labels = buildFileDisplayLabels(ordered, (file) => app.metadataCache.getFileCache(file));
	const search = paths.map((path, index) => `${labels[index] ?? path} ${path}`);
	return { paths, labels, search };
}
