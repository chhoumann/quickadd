import { describe, it, expect, vi } from "vitest";
import { createMockApp, createFile } from "../../tests/helpers/formatters/captureFixtures";
import { createCaptureFormatterPlugin } from "../../tests/helpers/formatters/plugin";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { CaptureChoiceFormatter } from "./captureChoiceFormatter";
import { templaterParseTemplate } from "../utilityObsidian";

vi.mock("../utilityObsidian", async () => (await import("../../tests/helpers/formatters/mocks")).utilityObsidianMock());
vi.mock("../main", async () => (await import("../../tests/helpers/formatters/mocks")).mainMock());
vi.mock("obsidian-dataview", async () => (await import("../../tests/helpers/formatters/mocks")).obsidiandataviewMock());

describe("Templater execution control", () => {
	it("should prevent double-execution of templater processing", async () => {
		const parse = vi.mocked(templaterParseTemplate);
		parse.mockImplementation(async (_app, content) => `rendered::${content}`);
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		const input = "Hello <% tp.date.now %>";
		expect(await formatter.formatContentOnly(input)).toBe(input);
		expect(parse).not.toHaveBeenCalled();

		const choice = new CaptureChoice("test");
		choice.captureToActiveFile = false;
		const first = await formatter.formatContentWithFile(input, choice, "", createFile());
		expect(parse).toHaveBeenCalledTimes(1);
		expect(first.content).toBe(`rendered::${input}`);

		const second = await formatter.formatContentWithFile(input, choice, "", createFile());
		expect(parse).toHaveBeenCalledTimes(1);
		expect(second.content).toBe(input);
	});
});
