import { Choice } from "./Choice";
import type ICaptureChoice from "./ICaptureChoice";
import type { BlankLineAfterMatchMode } from "./ICaptureChoice";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";
import type { AppendLinkOptions } from "../linkPlacement";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";

export class CaptureChoice extends Choice implements ICaptureChoice {
	appendLink: boolean | AppendLinkOptions;
	captureTo: string;
	captureToActiveFile: boolean;
	captureToCanvasNodeId: string;
	activeFileWritePosition: "cursor" | "top" | "bottom";
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
		inline?: boolean;
		replaceExisting?: boolean;
		blankLineAfterMatchMode?: BlankLineAfterMatchMode;
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
		this.captureToCanvasNodeId = "";
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
			inline: false,
			replaceExisting: false,
			blankLineAfterMatchMode: "auto",
		};
		this.newLineCapture = {
			enabled: false,
			direction: "below",
		};
		this.prepend = false;
		this.task = false;
		this.openFile = false;
		this.fileOpening = normalizeFileOpening();
		this.templater = {
			afterCapture: "none",
		};
	}

	public static Load(choice: ICaptureChoice): CaptureChoice {
		const loaded = choice as CaptureChoice;
		// Ensure backward compatibility: default to "cursor" if not set
		if (
			loaded.activeFileWritePosition !== "cursor" &&
			loaded.activeFileWritePosition !== "top" &&
			loaded.activeFileWritePosition !== "bottom"
		) {
			loaded.activeFileWritePosition = "cursor";
		}
		if (typeof loaded.captureToCanvasNodeId !== "string") {
			loaded.captureToCanvasNodeId = "";
		}
		if (
			loaded.captureToActiveFile &&
			loaded.prepend &&
			loaded.activeFileWritePosition !== "top" &&
			!loaded.insertAfter?.enabled &&
			!loaded.newLineCapture?.enabled
		) {
			loaded.activeFileWritePosition = "bottom";
			loaded.prepend = false;
		}
		if (!loaded.templater) loaded.templater = { afterCapture: "none" };
		if (loaded.templater.afterCapture !== "wholeFile") {
			loaded.templater.afterCapture = "none";
		}
		if (loaded.insertAfter && !loaded.insertAfter.blankLineAfterMatchMode) {
			loaded.insertAfter.blankLineAfterMatchMode = "auto";
		}
		if (loaded.insertAfter && loaded.insertAfter.inline === undefined) {
			loaded.insertAfter.inline = false;
		}
		if (loaded.insertAfter && loaded.insertAfter.replaceExisting === undefined) {
			loaded.insertAfter.replaceExisting = false;
		}
		return loaded;
	}
}
