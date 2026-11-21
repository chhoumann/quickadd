import { Choice } from "./Choice";
import type ICaptureChoice from "./ICaptureChoice";
import type {
	BlankLineAfterMatchMode,
	SectionOrdering,
} from "./ICaptureChoice";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";
import type { AppendLinkOptions } from "../linkPlacement";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";

export class CaptureChoice extends Choice implements ICaptureChoice {
	propertyCapture?: ICaptureChoice["propertyCapture"];
	appendLink: boolean | AppendLinkOptions;
	copyLinkToClipboard: boolean;
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
		orderBy?: SectionOrdering;
		promptHeading?: boolean;
	};
	insertBefore: {
		enabled: boolean;
		before: string;
		createIfNotFound: boolean;
		createIfNotFoundLocation: string;
	};
	newLineCapture: {
		enabled: boolean;
		direction: "above" | "below";
	};
	prepend: boolean;
	task: boolean;
	eachLine?: boolean;
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
		this.copyLinkToClipboard = false;
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
		// Only read once "After line…" is picked. Most After-line captures append
		// to the section and create a missing heading, so new ones start that way
		// (#2007). Saved choices keep theirs.
		this.insertAfter = {
			enabled: false,
			after: "",
			insertAtEnd: true,
			considerSubsections: false,
			createIfNotFound: true,
			createIfNotFoundLocation: "top",
			inline: false,
			replaceExisting: false,
			blankLineAfterMatchMode: "auto",
			promptHeading: false,
		};
		this.insertBefore = {
			enabled: false,
			before: "",
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
		this.fileOpening = normalizeFileOpening();
		this.templater = {
			afterCapture: "none",
		};
	}
}
