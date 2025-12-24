import type IChoice from "./IChoice";
import type { AppendLinkOptions } from "../linkPlacement";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";

export type BlankLineAfterMatchMode = "auto" | "skip" | "none";

export default interface ICaptureChoice extends IChoice {
	captureTo: string;
	captureToActiveFile: boolean;
	activeFileWritePosition?: "cursor" | "top";
	createFileIfItDoesntExist: {
		enabled: boolean;
		createWithTemplate: boolean;
		template: string;
	};
	format: { enabled: boolean; format: string };
	/**
		* Override whether editor selection should be used as the default {{VALUE}}.
		* Undefined means follow the global setting.
		*/
	useSelectionAsCaptureValue?: boolean;
	/** Capture to bottom of file (after current file content). */
	prepend: boolean;
	/** 
		* Configure link appending behavior.
		* - boolean: Legacy format for backward compatibility (true = enabled with default placement)
		* - AppendLinkOptions: New format with configurable placement options
		*/
	appendLink: boolean | AppendLinkOptions;
	task: boolean;
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
}
