import type ITemplateChoice from "./ITemplateChoice";
import { DEFAULT_TEMPLATE_INSERTION } from "./ITemplateChoice";
import { Choice } from "./Choice";
import type { fileExistsChoices } from "src/constants";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";
import type { AppendLinkOptions } from "../linkPlacement";

export class TemplateChoice extends Choice implements ITemplateChoice {
	appendLink: boolean | AppendLinkOptions;
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
	insertion: ITemplateChoice["insertion"];

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
		this.insertion = {
			enabled: DEFAULT_TEMPLATE_INSERTION.enabled,
			placement: DEFAULT_TEMPLATE_INSERTION.placement,
			templateSource: { ...DEFAULT_TEMPLATE_INSERTION.templateSource },
		};
	}

	public static Load(choice: ITemplateChoice): TemplateChoice {
		return choice as TemplateChoice;
	}
}
