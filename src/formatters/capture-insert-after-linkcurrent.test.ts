import { describe, it, expect } from "vitest";
import { LINK_TO_CURRENT_FILE_REGEX, TITLE_REGEX } from "../constants";

// Local helper mirroring Formatter.replaceLinkToCurrentFileInString,
// but without importing Formatter (to avoid obsidian deps in tests).
async function replaceLinkToCurrentFileInString(
	input: string,
	currentFileLink: string | null
): Promise<string> {
	let output = input;
	if (!currentFileLink && LINK_TO_CURRENT_FILE_REGEX.test(output)) {
		throw new Error("Unable to get current file path.");
	} else if (!currentFileLink) {
		return output;
	}

	while (LINK_TO_CURRENT_FILE_REGEX.test(output)) {
		output = output.replace(LINK_TO_CURRENT_FILE_REGEX, currentFileLink);
	}

	return output;
}

// Helper mirroring CaptureChoiceFormatter logic for finding insertion index
function normalizeTarget(target: string): string {
	return target.replace("\\n", "").trimEnd();
}

function findInsertAfterIndex(lines: string[], rawTarget: string): number {
	const target = normalizeTarget(rawTarget);
	let partialIndex = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].trimStart();

		if (line === target) return i;

		if (line.startsWith(target)) {
			const suffix = line.slice(target.length);
			if (/^\s*$/.test(suffix)) return i;
			if (partialIndex === -1) partialIndex = i;
		}
	}

	return partialIndex;
}

function insertTextAfterPositionInBody(
	text: string,
	body: string,
	pos: number
): string {
	if (pos === -1) return `${text}\n${body}`;
	const split = body.split("\n");
	const pre = split.slice(0, pos + 1).join("\n");
	const post = split.slice(pos + 1).join("\n");
	return `${pre}\n${text}${post}`;
}

describe("Insert after — {{linkcurrent}} resolution", () => {
	it("resolves {{linkcurrent}} in the target and inserts after the actual link line", async () => {
		const currentLink = "[[Target Note]]";
		// Simulate a file that already contains a link to the current file
		const fileContent = ["# Inbox", "", currentLink, "Other content"].join(
			"\n"
		);

		const rawTarget = "{{linkcurrent}}";

		// Sanity: ensure regex detects the token
		expect(LINK_TO_CURRENT_FILE_REGEX.test(rawTarget)).toBe(true);

		const resolvedTarget = await replaceLinkToCurrentFileInString(
			rawTarget,
			currentLink
		);
		expect(resolvedTarget).toBe(currentLink);

		const lines = fileContent.split("\n");
		const idx = findInsertAfterIndex(lines, resolvedTarget);
		expect(idx).toBe(2); // Should match the existing link line

		const newContent = insertTextAfterPositionInBody(
			"- [ ] Inserted task\n",
			fileContent,
			idx
		);
		const expected = [
			"# Inbox",
			"",
			"[[Target Note]]",
			"- [ ] Inserted task",
			"Other content",
		].join("\n");

		expect(newContent).toBe(expected);
	});

	it("creates the line with resolved link (not literal token) when not found", async () => {
		const currentLink = "[[Target Note]]";
		const fileContent = "# Empty\n";
		const rawTarget = "{{linkcurrent}}";

		const resolvedTarget = await replaceLinkToCurrentFileInString(
			rawTarget,
			currentLink
		);
		expect(resolvedTarget).toBe(currentLink);

		// Simulate the create-if-not-found flow: build the header line + formatted content
		const insertAfterLineAndFormatted = `${resolvedTarget}\nCONTENT`; // mirrors formatter behavior
		const newContent = `${fileContent}\n${insertAfterLineAndFormatted}`.replace(
			/\n\n+$/,
			"\n"
		);

		expect(newContent.includes("[[Target Note]]")).toBe(true);
		expect(newContent.includes("{{linkcurrent}}")).toBe(false);
	});
});

// Local helper mirroring Formatter.replaceTitleInString without importing it
function replaceTitleInStringLocal(input: string, title: string): string {
	let output = input;
	while (TITLE_REGEX.test(output)) {
		output = output.replace(TITLE_REGEX, title);
	}
	return output;
}

describe("Insert after — {{title}} resolution", () => {
	it("resolves {{title}} in the target and inserts after the actual title line", async () => {
		const title = "My Title";
		const fileContent = ["# Inbox", title, "Body"].join("\n");

		const rawTarget = "{{title}}";
		const resolvedTarget = replaceTitleInStringLocal(rawTarget, title);
		expect(resolvedTarget).toBe(title);

		const lines = fileContent.split("\n");
		const idx = findInsertAfterIndex(lines, resolvedTarget);
		expect(idx).toBe(1);

		const newContent = insertTextAfterPositionInBody(
			"Inserted\n",
			fileContent,
			idx
		);
		const expected = ["# Inbox", title, "Inserted", "Body"].join("\n");
		expect(newContent).toBe(expected);
	});

	it("creates the line with resolved title (not literal token) when not found", async () => {
		const title = "My Title";
		const fileContent = "# Empty\n";
		const rawTarget = "{{title}}";
		const resolvedTarget = replaceTitleInStringLocal(rawTarget, title);

		const insertAfterLineAndFormatted = `${resolvedTarget}\nCONTENT`;
		const newContent = `${fileContent}\n${insertAfterLineAndFormatted}`.replace(
			/\n\n+$/,
			"\n"
		);

		expect(newContent.includes(title)).toBe(true);
		expect(newContent.includes("{{title}}")).toBe(false);
	});
});
