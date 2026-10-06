import { vi } from "vitest";
import type * as templateFolderUtils from "src/utils/templateFolderUtils";

type TemplateFolderUtils = typeof templateFolderUtils;

/**
 * A `templateFolderUtils` mock whose vault holds every template a run names, so
 * an engine test whose app stands in for the vault gets past the run's check
 * that its template is there. `vi.mocked(getTemplateFile)` can still say one is
 * missing.
 */
export async function everyTemplateExists(
	importOriginal: () => Promise<TemplateFolderUtils>,
): Promise<TemplateFolderUtils> {
	const actual = await importOriginal();
	const { TFile } = await import("obsidian");
	return {
		...actual,
		getTemplateFile: vi.fn((_app, templatePath: string) => {
			const path = actual.resolveTemplatePath(templatePath);
			if (!path) return null;
			const name = path.split("/").pop() ?? path;
			const extension = name.split(".").pop() ?? "";
			return Object.assign(new TFile(), {
				path, name, extension, basename: name.slice(0, -(extension.length + 1)),
			});
		}),
	};
}
