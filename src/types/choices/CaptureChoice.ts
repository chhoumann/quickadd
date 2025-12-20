import { Choice } from "./Choice";
import type ICaptureChoice from "./ICaptureChoice";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";
import type { AppendLinkOptions } from "../linkPlacement";

export class CaptureChoice extends Choice implements ICaptureChoice {
	appendLink: boolean | AppendLinkOptions;
	captureTo: string;
	captureToActiveFile: boolean;
	activeFileWritePosition: "cursor" | "top";
	createFileIfItDoesntExist: {
		enabled: boolean;
		createWithTemplate: boolean;
		template: string;
	};
	format: { enabled: boolean; format: string };
	useSelectionAsCaptureValue?: boolean;
	insertAfter: {
		enabled: boolean;
		after: string;
		insertAtEnd: boolean;
		considerSubsections: boolean;
		createIfNotFound: boolean;
		createIfNotFoundLocation: string;
	};
	newLineCapture: {
		enabled: boolean;
		direction: "above" | "below";
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
	templater?: {
		afterCapture?: "none" | "wholeFile";
	};

	constructor(name: string) {
		super(name, "Capture");

		this.appendLink = false;
		this.captureTo = "";
		this.captureToActiveFile = false;
		this.activeFileWritePosition = "cursor";
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
		this.newLineCapture = {
			enabled: false,
			direction: "below",
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
		this.templater = {
			afterCapture: "none",
		};
	}

	public static Load(choice: ICaptureChoice): CaptureChoice {
		const loaded = choice as CaptureChoice;
		// Ensure backward compatibility: default to "cursor" if not set
		if (!loaded.activeFileWritePosition) {
			loaded.activeFileWritePosition = "cursor";
		}
		if (!loaded.templater) loaded.templater = { afterCapture: "none" };
		if (loaded.templater.afterCapture !== "wholeFile") {
			loaded.templater.afterCapture = "none";
		}
		return loaded;
	}
}
