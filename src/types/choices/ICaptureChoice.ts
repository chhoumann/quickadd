import type IChoice from "./IChoice";
import type { NewTabDirection } from "../newTabDirection";
import type { FileViewMode } from "../fileViewMode";
import type { AppendLinkOptions } from "../linkPlacement";
import type { OpenLocation, FileViewMode2 } from "../../utilityObsidian";

export default interface ICaptureChoice extends IChoice {
	captureTo: string;
	captureToActiveFile: boolean;
	createFileIfItDoesntExist: {
		enabled: boolean;
		createWithTemplate: boolean;
		template: string;
	};
	format: { enabled: boolean; format: string };
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
	};
	openFileInNewTab: {
		enabled: boolean;
		direction: NewTabDirection;
		focus: boolean;
	};
	openFile: boolean;
	openFileInMode: FileViewMode;
	/** New flexible file opening options */
	fileOpening?: {
		location: OpenLocation;
		direction: "vertical" | "horizontal";
		mode: FileViewMode2;
		focus: boolean;
	};
}
