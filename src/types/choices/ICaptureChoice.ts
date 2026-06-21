import type IChoice from "./IChoice";
import type { AppendLinkOptions } from "../linkPlacement";
import type { OpenLocation, FileViewMode2 } from "../fileOpening";

export type BlankLineAfterMatchMode = "auto" | "skip" | "none";

/** How to derive a sort key from a section heading's text (issue #481). */
export type SectionOrderBy =
	| "insertion"
	| "lexical"
	| "date"
	| "numeric"
	| "semver";
export type SectionOrderDirection = "asc" | "desc";
/** Where to rank EXISTING sibling headings whose text can't be parsed. */
export type UnparseableKeyPolicy = "bottom" | "top";

/**
 * Ordering descriptor for the "ordered" create-if-not-found location. A missing
 * insert-after heading is created at its sorted position among same-level
 * siblings. Read ONLY when `insertAfter.createIfNotFoundLocation === "ordered"`.
 */
export interface SectionOrdering {
	by: SectionOrderBy; // default "insertion"
	direction: SectionOrderDirection; // default "desc" (newest/highest on top)
	dateFormat?: string; // moment parse format, only when by === "date"
	unparseable?: UnparseableKeyPolicy; // default "bottom"; ranks EXISTING unparseable siblings
}

export default interface ICaptureChoice extends IChoice {
	captureTo: string;
	captureToActiveFile: boolean;
	captureToCanvasNodeId?: string;
	activeFileWritePosition?: "cursor" | "top" | "bottom";
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
	/** Copy a link to the captured file after the capture runs. */
	copyLinkToClipboard?: boolean;
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
		/**
			* Sort descriptor for the "ordered" create-if-not-found location. Read ONLY
			* when `createIfNotFoundLocation === "ordered"`. Absent for every other
			* location, so existing choices round-trip byte-identically (issue #481).
			*/
		orderBy?: SectionOrdering;
		/**
			* When true (the "Choose heading when capturing" option of "After line…"), the
			* insert-after target is chosen at capture time from a dropdown of the target
			* note's headings instead of the static `after` text. Resolved fresh each run and
			* applied via a formatter override; never persisted back into `after`. Undefined ⇒
			* false (no migration).
			*/
		promptHeading?: boolean;
	};
	insertBefore?: {
		enabled: boolean;
		before: string;
		createIfNotFound: boolean;
		createIfNotFoundLocation: string;
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
