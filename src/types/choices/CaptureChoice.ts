import { Choice } from "./Choice";
import type ICaptureChoice from "./ICaptureChoice";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";

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
	openFile: boolean;
	fileOpening: {
		location: OpenLocation;
		direction: "vertical" | "horizontal";
		mode: FileViewMode2;
		focus: boolean;
	};

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
		this.openFile = false;
		this.fileOpening = {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		};
	}

	public static Load(choice: ICaptureChoice): CaptureChoice {
		return choice as CaptureChoice;
	}
}
