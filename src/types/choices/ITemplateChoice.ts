import type IChoice from "./IChoice";
import type { fileExistsChoices } from "src/constants";
import type { AppendLinkOptions } from "../linkPlacement";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";

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
}
