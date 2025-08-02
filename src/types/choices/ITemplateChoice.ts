import type IChoice from "./IChoice";
import type { NewTabDirection } from "../newTabDirection";
import type { FileViewMode } from "../fileViewMode";
import type { fileExistsChoices } from "src/constants";
import type { AppendLinkOptions } from "../linkPlacement";

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
	openFileInNewTab: {
		enabled: boolean;
		direction: NewTabDirection;
		focus: boolean;
	};
	openFileInMode: FileViewMode;
	fileExistsMode: (typeof fileExistsChoices)[number];
	setFileExistsBehavior: boolean;
}
