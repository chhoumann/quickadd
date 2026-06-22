import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import {
	appendConfiguredFrontmatterPropertyLinkValue,
	appendLinkToFrontmatterProperty,
	type FrontmatterPropertyTarget,
} from "./frontmatterPropertyLinks";
import { log } from "../logger/logManager";

afterEach(() => {
	vi.restoreAllMocks();
});

function makeFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.basename = file.name.replace(/\.md$/i, "");
	file.extension = "md";
	return file;
}

describe("appendLinkToFrontmatterProperty failure visibility (audit)", () => {
	it("surfaces a high-visibility error (logError) instead of a low-key warning when the append fails", async () => {
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const logWarning = vi
			.spyOn(log, "logWarning")
			.mockImplementation(() => {});

		const targetFile = makeFile("Host.md");
		const createdFile = makeFile("Created.md");
		const app = {
			fileManager: {
				generateMarkdownLink: vi.fn(() => "[[Created]]"),
				processFrontMatter: vi.fn(async () => {
					throw new Error("write failed");
				}),
			},
		} as unknown as App;

		await expect(
			appendLinkToFrontmatterProperty(
				app,
				{ file: targetFile, key: "related" } satisfies FrontmatterPropertyTarget,
				createdFile,
			),
		).resolves.toBe(false);

		expect(logError).toHaveBeenCalledTimes(1);
		expect(logWarning).not.toHaveBeenCalled();
		const message = logError.mock.calls[0]?.[0] as string;
		expect(message).toContain("could not append the link");
		expect(message).toContain("'related'");
	});
});

describe("appendConfiguredFrontmatterPropertyLinkValue error labels (audit)", () => {
	it("uses the UI label, not the raw enum, when a scalar cannot be converted in 'error' mode", () => {
		expect(() =>
			appendConfiguredFrontmatterPropertyLinkValue(
				{ related: "[[Existing]]" },
				"related",
				"[[Created]]",
				"error",
			),
		).toThrow(/Require list/);
		expect(() =>
			appendConfiguredFrontmatterPropertyLinkValue(
				{ related: "[[Existing]]" },
				"related",
				"[[Created]]",
				"error",
			),
		).not.toThrow(/'error'/);
	});

	it("uses the UI label, not the raw enum, when a scalar cannot be converted in 'createProperty' mode", () => {
		expect(() =>
			appendConfiguredFrontmatterPropertyLinkValue(
				{ related: "[[Existing]]" },
				"related",
				"[[Created]]",
				"createProperty",
			),
		).toThrow(/Create if missing/);
		expect(() =>
			appendConfiguredFrontmatterPropertyLinkValue(
				{ related: "[[Existing]]" },
				"related",
				"[[Created]]",
				"createProperty",
			),
		).not.toThrow(/'createProperty'/);
	});

	it("points the user at the 'Create or convert' option that would succeed", () => {
		expect(() =>
			appendConfiguredFrontmatterPropertyLinkValue(
				{ related: "[[Existing]]" },
				"related",
				"[[Created]]",
				"error",
			),
		).toThrow(/Create or convert/);
	});
});
