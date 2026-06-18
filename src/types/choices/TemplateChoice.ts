import type ITemplateChoice from "./ITemplateChoice";
import type { TemplateFolderConfig } from "./ITemplateChoice";
import { Choice } from "./Choice";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";
import type { AppendLinkOptions } from "../linkPlacement";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";
import type { TemplateFileExistsBehavior } from "../../template/fileExistsPolicy";

export class TemplateChoice extends Choice implements ITemplateChoice {
	appendLink: boolean | AppendLinkOptions;
	copyLinkToClipboard: boolean;
	discoverExistingNotesBeforeCreate: boolean;
	fileNameFormat: { enabled: boolean; format: string };
	folder: TemplateFolderConfig;
	openFile: boolean;
	fileOpening: {
		location: OpenLocation;
		direction: "vertical" | "horizontal";
		mode: FileViewMode2;
		focus: boolean;
	};
	templatePath: string;
	fileExistsBehavior: TemplateFileExistsBehavior;

	constructor(name: string) {
		super(name, "Template");

		this.templatePath = "";
		this.fileNameFormat = { enabled: false, format: "" };
		this.discoverExistingNotesBeforeCreate = false;
		this.folder = {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		};
		this.appendLink = false;
		this.copyLinkToClipboard = false;
		this.openFile = false;
		this.fileOpening = normalizeFileOpening();
		this.fileExistsBehavior = { kind: "prompt" };
	}

	public static Load(choice: ITemplateChoice): TemplateChoice {
		return choice as TemplateChoice;
	}
}
