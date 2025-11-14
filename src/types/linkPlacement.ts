/**
 * Defines where a link should be placed when appending to content.
 */
export type LinkPlacement = 
	| "replaceSelection"  // Replace the current selection with the link
	| "afterSelection"    // Insert the link after the current selection
	| "endOfLine"         // Insert the link at the end of the current line
	| "newLine";          // Insert the link on a new line

export type LinkType = "link" | "embed";

export function placementSupportsEmbed(placement: LinkPlacement): boolean {
	return placement === "replaceSelection";
}

function sanitizeLinkType(
	linkType: LinkType | undefined,
	placement: LinkPlacement,
): LinkType {
	return linkType === "embed" && placementSupportsEmbed(placement)
		? "embed"
		: "link";
}

/**
 * Configuration options for appending links to content.
 * Provides granular control over link placement behavior.
 */
export interface AppendLinkOptions {
	/** Whether link appending is enabled */
	enabled: boolean;
	/** Where to place the appended link */
	placement: LinkPlacement;
	/**
		* When true, throw an error if no active file is available for link insertion.
		* When false, skip link insertion silently if there is no active file.
		*/
	requireActiveFile: boolean;
	/**
		* Controls how the link renders. "embed" is only respected when placement is replaceSelection.
		* Defaults to "link" for legacy settings.
		*/
	linkType?: LinkType;
	/**
	* Optional formatted path (supports capture format syntax) for the file that should receive the link.
	* When provided, the append-link operation targets that file instead of the active editor.
	*/
	targetFile?: string;
}

/**
 * Type guard to check if appendLink value is the new options format.
 * @param appendLink - The appendLink value to check
 * @returns True if the value is AppendLinkOptions, false if it's a boolean
 */
export function isAppendLinkOptions(appendLink: boolean | AppendLinkOptions): appendLink is AppendLinkOptions {
	return (
		typeof appendLink === "object" &&
		appendLink !== null &&
		"enabled" in appendLink &&
		"placement" in appendLink
	);
}

/**
 * Normalizes appendLink value from legacy boolean format to new options format.
 * Maintains backward compatibility by converting true/false to equivalent options.
 * 
 * @param appendLink - Legacy boolean or new options format
 * @returns Normalized AppendLinkOptions
 */
export function normalizeAppendLinkOptions(appendLink: boolean | AppendLinkOptions): AppendLinkOptions & { linkType: LinkType } {
	if (isAppendLinkOptions(appendLink)) {
		const placement = appendLink.placement ?? "replaceSelection";

		return {
			enabled: appendLink.enabled,
			placement,
			requireActiveFile: appendLink.requireActiveFile ?? true,
			linkType: sanitizeLinkType(appendLink.linkType, placement),
			targetFile: appendLink.targetFile,
		};
	}

	// Convert legacy boolean format to new options format
	return {
		enabled: appendLink,
		placement: "replaceSelection", // Default placement for backward compatibility
		requireActiveFile: appendLink ? true : false,
		linkType: "link",
		targetFile: undefined,
	};
}

/**
 * Gets the enabled state from either format of appendLink.
 * @param appendLink - Boolean or options format
 * @returns Whether link appending is enabled
 */
export function isAppendLinkEnabled(appendLink: boolean | AppendLinkOptions): boolean {
	return isAppendLinkOptions(appendLink) ? appendLink.enabled : appendLink;
}

// TODO: Consider adding a formal migration in a future major version to:
// 1. Convert all boolean appendLink values to AppendLinkOptions objects in saved settings
// 2. Remove the boolean union type from ICaptureChoice and ITemplateChoice interfaces  
// 3. Remove normalizeAppendLinkOptions() runtime conversion helper
// This would clean up the schema but requires traversing choices, MultiChoice trees,
// and macro-embedded choices. Runtime conversion is currently preferred due to lower
// risk and the fact that migration wouldn't eliminate the need for normalization
// (imported settings, 3rd-party scripts, etc.). See issue #166 implementation discussion.
