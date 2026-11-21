import type ITemplateChoice from "./ITemplateChoice";
import type { TemplateFolderConfig } from "./ITemplateChoice";
import { Choice } from "./Choice";
import type { FileOpeningSettings } from "../fileOpening";
import type { AppendLinkOptions } from "../linkPlacement";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";
import type { TemplateExistingNoteAction, TemplateFileExistsBehavior } from "../../template/fileExistsPolicy";

export class TemplateChoice extends Choice implements ITemplateChoice {
	appendLink: boolean | AppendLinkOptions;
	copyLinkToClipboard: boolean;
	discoverExistingNotesBeforeCreate: boolean;
	existingNoteAction?: TemplateExistingNoteAction;
	fileNameFormat: { enabled: boolean; format: string };
	folder: TemplateFolderConfig;
	openFile: boolean;
	fileOpening: FileOpeningSettings;
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
}
