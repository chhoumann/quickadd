import { createFile, createMockApp } from "../../tests/helpers/formatters/captureFixtures";
import { createCaptureFormatterPlugin } from "../../tests/helpers/formatters/plugin";
import { describe, expect, it, vi } from "vitest";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

vi.mock("../utils/templaterIntegration", async () => (await import("../../tests/helpers/formatters/mocks")).templaterIntegrationMock());

import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

const insertAfterChoice = (
	after: string,
	createIfNotFound = false,
): ICaptureChoice =>
	({
		id: "test",
		name: "Test Choice",
		type: "Capture",
		command: false,
		captureTo: "Inbox.md",
		captureToActiveFile: false,
		captureToCanvasNodeId: "",
		activeFileWritePosition: "cursor",
		createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
		format: { enabled: false, format: "" },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: true,
			after,
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound,
			createIfNotFoundLocation: "bottom",
			inline: false,
			replaceExisting: false,
			blankLineAfterMatchMode: "auto",
		},
		insertBefore: { enabled: false, before: "", createIfNotFound: false, createIfNotFoundLocation: "top" },
		newLineCapture: { enabled: false, direction: "below" },
		openFile: false,
		fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: true },
	}) as ICaptureChoice;

/** A formatter whose active note links as `[[Target Note]]`. */
const formatterWithActiveNote = () => {
	const app = createMockApp();
	vi.mocked(app.workspace.getActiveFile).mockReturnValue(createFile("Target Note.md"));
	vi.mocked(app.fileManager.generateMarkdownLink).mockReturnValue("[[Target Note]]");
	return new CaptureChoiceFormatter(app, createCaptureFormatterPlugin());
};

const capture = async (
	formatter: CaptureChoiceFormatter,
	choice: ICaptureChoice,
	fileContent: string,
	input: string,
) => (await formatter.formatContentWithFile(input, choice, fileContent, createFile("Inbox.md"))).content;

describe("Insert after - format syntax in the target", () => {
	it("resolves {{linkcurrent}} and inserts after the existing link line", async () => {
		const content = await capture(
			formatterWithActiveNote(),
			insertAfterChoice("{{linkcurrent}}"),
			"# Inbox\n\n[[Target Note]]\nOther content",
			"- [ ] Inserted task\n",
		);

		expect(content).toBe("# Inbox\n\n[[Target Note]]\n- [ ] Inserted task\nOther content");
	});

	it("creates a missing {{linkcurrent}} target with the resolved link, not the token", async () => {
		const content = await capture(
			formatterWithActiveNote(),
			insertAfterChoice("{{linkcurrent}}", true),
			"# Empty\n",
			"CONTENT\n",
		);

		expect(content).toBe("# Empty\n[[Target Note]]\nCONTENT\n");
	});

	it("resolves {{title}} and inserts after the matching title line", async () => {
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		formatter.setTitle("My Title");

		const content = await capture(formatter, insertAfterChoice("{{title}}"), "# Inbox\nMy Title\nBody", "Inserted\n");

		expect(content).toBe("# Inbox\nMy Title\nInserted\nBody");
	});

	it("creates a missing {{title}} target with the resolved title, not the token", async () => {
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		formatter.setTitle("My Title");

		const content = await capture(formatter, insertAfterChoice("{{title}}", true), "# Empty\n", "CONTENT\n");

		expect(content).toBe("# Empty\nMy Title\nCONTENT\n");
	});
});

describe("Insert after - table separator targets", () => {
	it("matches a table separator row whose last cell is the target", async () => {
		const content = await capture(
			formatterWithActiveNote(),
			insertAfterChoice("| ----- |"),
			[
				"| Name          | Quantity | HH:MM |",
				"| ------------- | -------- | ----- |",
				"| data          | 5        | 10:00 |",
			].join("\n"),
			"| new | row |\n",
		);

		expect(content).toBe(
			[
				"| Name          | Quantity | HH:MM |",
				"| ------------- | -------- | ----- |",
				"| new | row |",
				"| data          | 5        | 10:00 |",
			].join("\n"),
		);
	});

	it("matches a separator row that is exactly the target", async () => {
		const content = await capture(
			formatterWithActiveNote(),
			insertAfterChoice("| ----- |"),
			"| Name | Quantity |\n| ----- |\n| data | 5 |",
			"| new |\n",
		);

		expect(content).toBe("| Name | Quantity |\n| ----- |\n| new |\n| data | 5 |");
	});
});
