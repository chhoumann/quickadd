import type IChoice from "./IChoice";
import type { NewTabDirection } from "../newTabDirection";
import type { FileViewMode } from "../fileViewMode";
import { fileExistsChoices } from "src/constants";

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
	appendLink: boolean;
	openFile: boolean;
	openFileInNewTab: {
		enabled: boolean;
		direction: NewTabDirection;
		focus: boolean;
	};
	openFileInMode: FileViewMode;
	fileExistsMode: typeof fileExistsChoices[number];
	setFileExistsBehavior: boolean;
}
