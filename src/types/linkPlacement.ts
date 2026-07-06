/**
 * Defines where a link should be placed when appending to content.
 */
export type LinkPlacement = 
	| "replaceSelection"  // Replace the current selection with the link
	| "afterSelection"    // Insert the link after the current selection
	| "endOfLine"         // Insert the link at the end of the current line
	| "newLine"           // Insert the link on a new line
	| "inFrontmatter";    // Insert the link into a frontmatter property

export type LinkType = "link" | "embed";

/**
 * What the inserted link displays. "none" adds no explicit alias (Obsidian
 * renders its default link text); "selection" keeps the selected text as the
 * link's display text for selection-based placements. Reserved future values
 * ("title", "custom") extend this enum without a schema break.
 */
export type LinkDisplayText = "none" | "selection";

export type AppendLinkDestination =
	| { type: "activeFile" }
	| { type: "specifiedFile"; path: string };

export type FrontmatterHandling =
	| "error"
	| "createProperty"
	| "alwaysAppend";

export const DEFAULT_FRONTMATTER_HANDLING: FrontmatterHandling = "alwaysAppend";

/**
 * Active-note Markdown body placements that insert into the editor and can
 * therefore carry an embed (`![[...]]`). "inFrontmatter" is excluded because a
 * frontmatter property value is link-only. Specified-note destinations stay
 * link-only via their own guards (sanitizeLinkType requires an activeFile
 * destination, and appendFileLinkToDestinationFile hardcodes "link"), so they
 * are unaffected by this set even when a body placement is selected.
 *
 * A new placement is NOT embed-capable until it is deliberately added here.
 */
const EMBED_CAPABLE_PLACEMENTS: ReadonlySet<LinkPlacement> = new Set([
	"replaceSelection",
	"afterSelection",
	"endOfLine",
	"newLine",
]);

export function placementSupportsEmbed(placement: LinkPlacement): boolean {
	return EMBED_CAPABLE_PLACEMENTS.has(placement);
}

export function placementSupportsFrontmatter(
	placement: LinkPlacement,
): boolean {
	return placement === "inFrontmatter";
}

/**
 * Placements whose insertion is anchored to the editor selection, so the
 * selected text can meaningfully become the link's display text (alias).
 * "endOfLine"/"newLine" are cursor-anchored, not selection-anchored, and
 * "inFrontmatter" has no selection concept at the destination.
 *
 * A new placement is NOT selection-alias-capable until deliberately added here.
 */
const SELECTION_ALIAS_CAPABLE_PLACEMENTS: ReadonlySet<LinkPlacement> = new Set([
	"replaceSelection",
	"afterSelection",
]);

export function placementSupportsSelectionAlias(
	placement: LinkPlacement,
): boolean {
	return SELECTION_ALIAS_CAPABLE_PLACEMENTS.has(placement);
}

function sanitizeLinkType(
	linkType: LinkType | undefined,
	placement: LinkPlacement,
	destination: AppendLinkDestination,
): LinkType {
	return linkType === "embed" &&
		destination.type === "activeFile" &&
		placementSupportsEmbed(placement)
		? "embed"
		: "link";
}

/**
 * Strict allowlist: "selection" survives only when every condition for a
 * selection-derived alias holds. Anything else — undefined, "", legacy boolean
 * configs, unknown values from imported settings or third-party scripts, and
 * future values this version doesn't know — normalizes to "none".
 */
function sanitizeDisplayText(
	displayText: LinkDisplayText | undefined,
	placement: LinkPlacement,
	destination: AppendLinkDestination,
	linkType: LinkType,
): LinkDisplayText {
	return displayText === "selection" &&
		destination.type === "activeFile" &&
		placementSupportsSelectionAlias(placement) &&
		linkType === "link"
		? "selection"
		: "none";
}

function normalizeAppendLinkDestination(
	destination: AppendLinkDestination | undefined,
): AppendLinkDestination {
	if (destination?.type === "specifiedFile") {
		return {
			type: "specifiedFile",
			path: typeof destination.path === "string" ? destination.path.trim() : "",
		};
	}

	return { type: "activeFile" };
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
	 * Controls how the link renders. "embed" is respected for the active note's
	 * Markdown body placements (replaceSelection, afterSelection, endOfLine,
	 * newLine). It is normalized to "link" for "inFrontmatter" and for
	 * specified-note destinations, which are link-only.
	 * Defaults to "link" for legacy settings.
	 */
	linkType?: LinkType;
	/**
	 * What the inserted link displays. "selection" keeps the selected text as
	 * the link's alias for the selection-based placements (replaceSelection,
	 * afterSelection) when inserting a plain link into the active note.
	 * Normalized to "none" everywhere else (embeds, frontmatter,
	 * endOfLine/newLine, specified-note destinations). Defaults to "none" for
	 * legacy settings.
	 */
	displayText?: LinkDisplayText;
	/**
	 * Where the generated link should be written. Omitted legacy settings target
	 * the active Markdown editor.
	 */
	destination?: AppendLinkDestination;
	/**
	 * Frontmatter property to append to when placement is "inFrontmatter".
	 */
	frontmatterProperty?: string;
	/**
	 * How to handle missing and non-list frontmatter properties.
	 */
	frontmatterHandling?: FrontmatterHandling;
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
export function normalizeAppendLinkOptions(appendLink: boolean | AppendLinkOptions): AppendLinkOptions & { linkType: LinkType; destination: AppendLinkDestination; displayText: LinkDisplayText } {
	if (isAppendLinkOptions(appendLink)) {
		const placement = appendLink.placement ?? "replaceSelection";
		const destination = normalizeAppendLinkDestination(appendLink.destination);
		const linkType = sanitizeLinkType(appendLink.linkType, placement, destination);

		return {
			enabled: appendLink.enabled,
			placement,
			requireActiveFile: appendLink.requireActiveFile ?? true,
			linkType,
			displayText: sanitizeDisplayText(
				appendLink.displayText,
				placement,
				destination,
				linkType,
			),
			destination,
			frontmatterProperty: appendLink.frontmatterProperty,
			frontmatterHandling:
				placementSupportsFrontmatter(placement)
					? appendLink.frontmatterHandling ?? DEFAULT_FRONTMATTER_HANDLING
					: appendLink.frontmatterHandling,
		};
	}

	// Convert legacy boolean format to new options format
	return {
		enabled: appendLink,
		placement: "replaceSelection", // Default placement for backward compatibility
		requireActiveFile: appendLink ? true : false,
		linkType: "link",
		displayText: "none",
		destination: { type: "activeFile" },
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
