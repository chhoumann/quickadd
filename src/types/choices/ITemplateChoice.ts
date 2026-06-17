import type IChoice from "./IChoice";
import type { AppendLinkOptions } from "../linkPlacement";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";
import type { TemplateFileExistsBehavior } from "../../template/fileExistsPolicy";

/**
 * Destination configuration for a Template choice. These four booleans encode a
 * set of mutually-exclusive destination modes at runtime (see
 * TemplateChoiceEngine.getFolderPath); the choice builder surfaces them through a
 * single derived dropdown (see gui/ChoiceBuilder/folderMode.ts).
 */
export type TemplateFolderConfig = {
	enabled: boolean;
	folders: string[];
	chooseWhenCreatingNote: boolean;
	createInSameFolderAsActiveFile: boolean;
	chooseFromSubfolders: boolean;
};

export default interface ITemplateChoice extends IChoice {
	templatePath: string;
	folder: TemplateFolderConfig;
	fileNameFormat: { enabled: boolean; format: string };
	/** 
	 * Configure link appending behavior. 
	 * - boolean: Legacy format for backward compatibility (true = enabled with default placement)
	 * - AppendLinkOptions: New format with configurable placement options
	 */
	appendLink: boolean | AppendLinkOptions;
	/** Copy a link to the created/resolved file after the template runs. */
	copyLinkToClipboard?: boolean;
	openFile: boolean;
	fileOpening: {
		location: OpenLocation;
		direction: "vertical" | "horizontal";
		mode: FileViewMode2;
		focus: boolean;
	};
	fileExistsBehavior: TemplateFileExistsBehavior;
}
