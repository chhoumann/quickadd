import type ITemplateChoice from "./ITemplateChoice";
import { Choice } from "./Choice";
import type { fileExistsChoices } from "src/constants";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";

export class TemplateChoice extends Choice implements ITemplateChoice {
	appendLink: boolean;
	fileNameFormat: { enabled: boolean; format: string };
	folder: {
		enabled: boolean;
		folders: string[];
		chooseWhenCreatingNote: boolean;
		createInSameFolderAsActiveFile: boolean;
		chooseFromSubfolders: boolean;
	};
	openFile: boolean;
	fileOpening: {
		location: OpenLocation;
		direction: "vertical" | "horizontal";
		mode: FileViewMode2;
		focus: boolean;
	};
	templatePath: string;
	fileExistsMode: (typeof fileExistsChoices)[number];
	setFileExistsBehavior: boolean;

	constructor(name: string) {
		super(name, "Template");

		this.templatePath = "";
		this.fileNameFormat = { enabled: false, format: "" };
		this.folder = {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		};
		this.appendLink = false;
		this.openFile = false;
		this.fileOpening = {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		};
		this.fileExistsMode = "Increment the file name";
		this.setFileExistsBehavior = false;
	}

	public static Load(choice: ITemplateChoice): TemplateChoice {
		return choice as TemplateChoice;
	}
}
