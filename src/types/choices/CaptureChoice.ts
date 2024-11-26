import { Choice } from "./Choice";
import type ICaptureChoice from "./ICaptureChoice";
import { NewTabDirection } from "../newTabDirection";
import type { FileViewMode } from "../fileViewMode";

export class CaptureChoice extends Choice implements ICaptureChoice {
	appendLink: boolean;
	captureTo: string;
	captureToActiveFile: boolean;
	createFileIfItDoesntExist: {
		enabled: boolean;
		createWithTemplate: boolean;
		template: string;
	};
	format: { enabled: boolean; format: string };
	insertAfter: {
		enabled: boolean;
		after: string;
		insertAtEnd: boolean;
		considerSubsections: boolean;
		createIfNotFound: boolean;
		createIfNotFoundLocation: string;
	};
	prepend: boolean;
	task: boolean;
	focusExsitingFileTab:boolean;
	openFileInNewTab: {
		enabled: boolean;
		direction: NewTabDirection;
		focus: boolean;
	};
	openFile: boolean;
	openFileInMode: FileViewMode;

	constructor(name: string) {
		super(name, "Capture");

		this.appendLink = false;
		this.captureTo = "";
		this.captureToActiveFile = false;
		this.createFileIfItDoesntExist = {
			enabled: false,
			createWithTemplate: false,
			template: "",
		};
		this.format = { enabled: false, format: "" };
		this.insertAfter = {
			enabled: false,
			after: "",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "top",
		};
		this.prepend = false;
		this.task = false;
		this.openFileInNewTab = {
			enabled: false,
			direction: NewTabDirection.vertical,
			focus: true,
		};
		this.openFile = false;
		this.openFileInMode = "default";
		this.focusExsitingFileTab=true
	}

	public static Load(choice: ICaptureChoice): CaptureChoice {
		return choice as CaptureChoice;
	}
}
