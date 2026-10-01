import { TFile, type App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import { FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, parseFileToken } from "../../utils/fileSyntax";
import { suggestForFile } from "./vaultPrompts";

const files = ["People/Thomas Anderson.md", "People/Neo Classic.md"].map((path) =>
	Object.assign(new TFile(), {
		path,
		name: path.slice("People/".length),
		basename: path.slice("People/".length, -".md".length),
		extension: "md",
	}),
);

vi.mock("../../utils/vaultQueries", () => ({ getFileTokenFiles: () => files }));

const app = {
	metadataCache: {
		getFileCache: (file: TFile) =>
			file.basename === "Thomas Anderson" ? { frontmatter: { aliases: ["Neo", "The One"] } } : null,
	},
} as unknown as App;

// A remote client (Raycast) filters by title, so a user who types a note's
// alias sends it as a custom value.
function remoteReply(reply: string) {
	const suggester = vi.fn(async () => reply);
	const executor = { promptProvider: { suggester } } as unknown as IChoiceExecutor;
	const parsed = parseFileToken("People|custom");
	if (!parsed) throw new Error("token did not parse");
	return suggestForFile({ app, executor, getSourcePath: () => null }, parsed);
}

describe("suggestForFile with a remote client", () => {
	it("picks the note whose alias was typed (#2062)", async () => {
		await expect(remoteReply("the one")).resolves.toBe(`${FILE_PICK_PREFIX}People/Thomas Anderson.md`);
	});

	it("keeps any other typed text as a custom value", async () => {
		await expect(remoteReply("Niobe")).resolves.toBe(`${FILE_CUSTOM_PREFIX}Niobe`);
	});
});
