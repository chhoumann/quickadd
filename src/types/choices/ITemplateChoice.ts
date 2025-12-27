import type IChoice from "./IChoice";
import type { fileExistsChoices } from "src/constants";
import type { AppendLinkOptions } from "../linkPlacement";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";

export type TemplateInsertionPlacement =
	| "currentLine"
	| "newLineAbove"
	| "newLineBelow"
	| "top"
	| "bottom"
	| "replaceSelection"
	| "afterSelection"
	| "endOfLine";

export type TemplateInsertionSourceType = "path" | "prompt" | "choice";

export type TemplateInsertionSource = {
	type: TemplateInsertionSourceType;
	value?: string;
};

export type TemplateInsertionConfig = {
	enabled: boolean;
	placement: TemplateInsertionPlacement;
	templateSource: TemplateInsertionSource;
};

export const DEFAULT_TEMPLATE_INSERTION: TemplateInsertionConfig = {
	enabled: false,
	placement: "currentLine",
	templateSource: { type: "path" },
};

export function normalizeTemplateInsertionConfig(
	insertion?: TemplateInsertionConfig,
): TemplateInsertionConfig {
	const source = insertion?.templateSource;
	return {
		enabled: insertion?.enabled ?? DEFAULT_TEMPLATE_INSERTION.enabled,
		placement: insertion?.placement ?? DEFAULT_TEMPLATE_INSERTION.placement,
		templateSource: {
			type: source?.type ?? DEFAULT_TEMPLATE_INSERTION.templateSource.type,
			value: source?.value ?? DEFAULT_TEMPLATE_INSERTION.templateSource.value,
		},
	};
}

export default interface ITemplateChoice extends IChoice {
	templatePath: string;
	folder: {
		enabled: boolean;
		folders: string[];
		chooseWhenCreatingNote: boolean;
		createInSameFolderAsActiveFile: boolean;
		chooseFromSubfolders: boolean;
	};
	fileNameFormat: { enabled: boolean; format: string };
	/** 
	 * Configure link appending behavior. 
	 * - boolean: Legacy format for backward compatibility (true = enabled with default placement)
	 * - AppendLinkOptions: New format with configurable placement options
	 */
	appendLink: boolean | AppendLinkOptions;
	openFile: boolean;
	fileOpening: {
		location: OpenLocation;
		direction: "vertical" | "horizontal";
		mode: FileViewMode2;
		focus: boolean;
	};
	fileExistsMode: (typeof fileExistsChoices)[number];
	setFileExistsBehavior: boolean;
	/** Optional insertion mode that inserts template content into the active file. */
	insertion?: TemplateInsertionConfig;
}
