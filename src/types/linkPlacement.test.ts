import { describe, expect, it } from "vitest";
import {
	type AppendLinkOptions,
	type LinkPlacement,
	isAppendLinkEnabled,
	isAppendLinkOptions,
	normalizeAppendLinkOptions,
	placementSupportsEmbed,
	placementSupportsFrontmatter,
	placementSupportsSelectionAlias,
} from "./linkPlacement";

describe("LinkPlacement", () => {
	describe("isAppendLinkOptions", () => {
		it("should return true for AppendLinkOptions object", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "newLine",
				requireActiveFile: true,
			};
			expect(isAppendLinkOptions(options)).toBe(true);
		});

		it("should return false for boolean values", () => {
			expect(isAppendLinkOptions(true)).toBe(false);
			expect(isAppendLinkOptions(false)).toBe(false);
		});

		it("should return false for null or undefined", () => {
			expect(isAppendLinkOptions(null as any)).toBe(false);
			expect(isAppendLinkOptions(undefined as any)).toBe(false);
		});
	});

	describe("normalizeAppendLinkOptions", () => {
		it("should normalize AppendLinkOptions and preserve values", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "afterSelection",
				requireActiveFile: false,
			};

			expect(normalizeAppendLinkOptions(options)).toEqual({
				...options,
				linkType: "link",
				displayText: "none",
				destination: { type: "activeFile" },
			});
		});

		it("should convert true to enabled with default placement", () => {
			const result = normalizeAppendLinkOptions(true);
			expect(result).toEqual({
				enabled: true,
				placement: "replaceSelection",
				requireActiveFile: true,
				linkType: "link",
				displayText: "none",
				destination: { type: "activeFile" },
			});
		});

		it("should convert false to disabled with default placement", () => {
			const result = normalizeAppendLinkOptions(false);
			expect(result).toEqual({
				enabled: false,
				placement: "replaceSelection",
				requireActiveFile: false,
				linkType: "link",
				displayText: "none",
				destination: { type: "activeFile" },
			});
		});

		it("should keep embed linkType when placement supports embeds", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "replaceSelection",
				requireActiveFile: true,
				linkType: "embed",
				destination: { type: "activeFile" },
			};

			expect(normalizeAppendLinkOptions(options)).toEqual({
				...options,
				displayText: "none",
			});
		});

		it("preserves embed linkType for every active-note body placement", () => {
			const bodyPlacements: LinkPlacement[] = [
				"replaceSelection",
				"afterSelection",
				"endOfLine",
				"newLine",
			];

			for (const placement of bodyPlacements) {
				const options: AppendLinkOptions = {
					enabled: true,
					placement,
					requireActiveFile: true,
					linkType: "embed",
					destination: { type: "activeFile" },
				};

				expect(normalizeAppendLinkOptions(options).linkType).toBe("embed");
			}
		});

		it("sanitizes embed linkType for frontmatter placement", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "inFrontmatter",
				requireActiveFile: true,
				linkType: "embed",
				frontmatterProperty: "related",
			};

			expect(normalizeAppendLinkOptions(options).linkType).toBe("link");
		});

		it("should default linkType to link when omitted", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "newLine",
				requireActiveFile: true,
			};

			expect(normalizeAppendLinkOptions(options).linkType).toBe("link");
		});

		it("preserves and trims a specified file destination", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "newLine",
				requireActiveFile: false,
				destination: { type: "specifiedFile", path: "  Indexes/MOC.md  " },
			};

			expect(normalizeAppendLinkOptions(options)).toEqual({
				...options,
				linkType: "link",
				displayText: "none",
				destination: { type: "specifiedFile", path: "Indexes/MOC.md" },
			});
		});

		it("sanitizes embeds for specified file destinations", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "replaceSelection",
				requireActiveFile: true,
				linkType: "embed",
				destination: { type: "specifiedFile", path: "Index.md" },
			};

			expect(normalizeAppendLinkOptions(options)).toEqual({
				...options,
				linkType: "link",
				displayText: "none",
				destination: { type: "specifiedFile", path: "Index.md" },
			});
		});

		it("should preserve frontmatter placement options", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "inFrontmatter",
				requireActiveFile: true,
				linkType: "embed",
				frontmatterProperty: "related",
				frontmatterHandling: "alwaysAppend",
			};

			expect(normalizeAppendLinkOptions(options)).toEqual({
				...options,
				linkType: "link",
				displayText: "none",
				destination: { type: "activeFile" },
			});
		});

		it("should default frontmatter handling to create or convert", () => {
			const options: AppendLinkOptions = {
				enabled: true,
				placement: "inFrontmatter",
				requireActiveFile: true,
				frontmatterProperty: "related",
			};

			expect(normalizeAppendLinkOptions(options).frontmatterHandling).toBe(
				"alwaysAppend",
			);
		});
	});

	describe("isAppendLinkEnabled", () => {
		it("should return enabled value from AppendLinkOptions", () => {
			const enabledOptions: AppendLinkOptions = {
				enabled: true,
				placement: "endOfLine",
				requireActiveFile: true,
			};
			const disabledOptions: AppendLinkOptions = {
				enabled: false,
				placement: "replaceSelection",
				requireActiveFile: true,
			};

			expect(isAppendLinkEnabled(enabledOptions)).toBe(true);
			expect(isAppendLinkEnabled(disabledOptions)).toBe(false);
		});

		it("should return boolean value directly", () => {
			expect(isAppendLinkEnabled(true)).toBe(true);
			expect(isAppendLinkEnabled(false)).toBe(false);
		});
	});

	describe("LinkPlacement type", () => {
		it("should accept all valid placement values", () => {
			const placements: LinkPlacement[] = [
				"replaceSelection",
				"afterSelection",
				"endOfLine",
				"newLine",
				"inFrontmatter",
			];

			for (const placement of placements) {
				const options: AppendLinkOptions = {
					enabled: true,
					placement,
					requireActiveFile: true,
				};
				expect(options.placement).toBe(placement);
			}
		});
	});

	describe("placementSupportsEmbed", () => {
		it("returns true for every active-note Markdown body placement", () => {
			expect(placementSupportsEmbed("replaceSelection")).toBe(true);
			expect(placementSupportsEmbed("afterSelection")).toBe(true);
			expect(placementSupportsEmbed("endOfLine")).toBe(true);
			expect(placementSupportsEmbed("newLine")).toBe(true);
		});

		it("returns false for frontmatter placement", () => {
			expect(placementSupportsEmbed("inFrontmatter")).toBe(false);
		});
	});

	describe("placementSupportsFrontmatter", () => {
		it("should return true only for frontmatter placement", () => {
			expect(placementSupportsFrontmatter("inFrontmatter")).toBe(true);
			expect(placementSupportsFrontmatter("replaceSelection")).toBe(false);
			expect(placementSupportsFrontmatter("afterSelection")).toBe(false);
			expect(placementSupportsFrontmatter("endOfLine")).toBe(false);
			expect(placementSupportsFrontmatter("newLine")).toBe(false);
		});
	});

	describe("placementSupportsSelectionAlias", () => {
		it("returns true only for selection-anchored placements", () => {
			expect(placementSupportsSelectionAlias("replaceSelection")).toBe(true);
			expect(placementSupportsSelectionAlias("afterSelection")).toBe(true);
			expect(placementSupportsSelectionAlias("endOfLine")).toBe(false);
			expect(placementSupportsSelectionAlias("newLine")).toBe(false);
			expect(placementSupportsSelectionAlias("inFrontmatter")).toBe(false);
		});
	});

	describe("displayText normalization", () => {
		const base: AppendLinkOptions = {
			enabled: true,
			placement: "replaceSelection",
			requireActiveFile: true,
		};

		it("keeps 'selection' for selection placements with a plain link into the active file", () => {
			for (const placement of ["replaceSelection", "afterSelection"] as LinkPlacement[]) {
				const normalized = normalizeAppendLinkOptions({
					...base,
					placement,
					displayText: "selection",
				});
				expect(normalized.displayText).toBe("selection");
			}
		});

		it("defaults to 'none' when displayText is omitted", () => {
			expect(normalizeAppendLinkOptions(base).displayText).toBe("none");
		});

		it("normalizes legacy boolean configs to 'none'", () => {
			expect(normalizeAppendLinkOptions(true).displayText).toBe("none");
			expect(normalizeAppendLinkOptions(false).displayText).toBe("none");
		});

		it("normalizes malformed and unknown values to 'none' (strict allowlist)", () => {
			for (const value of ["", "SELECTION", "title", "custom", 1, true, null]) {
				const normalized = normalizeAppendLinkOptions({
					...base,
					displayText: value as AppendLinkOptions["displayText"],
				});
				expect(normalized.displayText).toBe("none");
			}
		});

		it("sanitizes 'selection' away for cursor-anchored and frontmatter placements", () => {
			for (const placement of ["endOfLine", "newLine", "inFrontmatter"] as LinkPlacement[]) {
				const normalized = normalizeAppendLinkOptions({
					...base,
					placement,
					displayText: "selection",
				});
				expect(normalized.displayText).toBe("none");
			}
		});

		it("sanitizes 'selection' away for embeds", () => {
			const normalized = normalizeAppendLinkOptions({
				...base,
				linkType: "embed",
				displayText: "selection",
			});
			expect(normalized.linkType).toBe("embed");
			expect(normalized.displayText).toBe("none");
		});

		it("sanitizes 'selection' away for specified-file destinations", () => {
			const normalized = normalizeAppendLinkOptions({
				...base,
				displayText: "selection",
				destination: { type: "specifiedFile", path: "Index.md" },
			});
			expect(normalized.displayText).toBe("none");
		});

		it("still sanitizes 'selection' when an embed request is downgraded by a specified-file destination", () => {
			// linkType embed + specifiedFile normalizes linkType to "link", but the
			// specified-file destination still rules out a selection alias.
			const normalized = normalizeAppendLinkOptions({
				...base,
				linkType: "embed",
				displayText: "selection",
				destination: { type: "specifiedFile", path: "Index.md" },
			});
			expect(normalized.linkType).toBe("link");
			expect(normalized.displayText).toBe("none");
		});
	});
});
