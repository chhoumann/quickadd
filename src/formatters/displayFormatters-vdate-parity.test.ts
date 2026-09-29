import realMoment from "moment";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import { DateFormatPreviewGenerator } from "./helpers/previewHelpers";
import type QuickAdd from "../main";

/**
 * The body and file-name previews render {{VDATE}} through one shared rule and
 * differ only where the file name must: no "(default: X)" / "(optional)" hints,
 * and a shorter placeholder when the format cannot be rendered.
 */

const app = {
	workspace: { getActiveFile: () => null },
	vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
	metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
} as unknown as App;

const plugin = {
	settings: { globalVariables: {}, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

const formatters = {
	body: () => new FormatDisplayFormatter(app, plugin),
	fileName: () => new FileNameDisplayFormatter(app, plugin),
};

const answered = `@date:${new Date(2026, 7, 15, 12, 0, 0).toISOString()}`;

const originalMoment = (window as unknown as { moment?: unknown }).moment;

beforeAll(() => {
	(window as unknown as { moment: unknown }).moment = realMoment;
});
afterAll(() => {
	(window as unknown as { moment?: unknown }).moment = originalMoment;
	vi.useRealTimers();
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2023-06-01T10:30:00"));
});
afterEach(() => {
	vi.restoreAllMocks();
});

describe.each(Object.entries(formatters))("%s preview {{VDATE}}", (_name, make) => {
	it.each([
		["{{VDATE:due,YYYY-MM-DD|endof:month}}", "2023-06-30"],
		["{{VDATE:due,MMMM|case:upper}}", "JUNE"],
		["{{VDATE:due,DD.MM.YYYY}} {{VALUE:due}}", "01.06.2023 01.06.2023"],
		["{{VDATE:,YYYY}}", "{{VDATE:,YYYY}}"],
	])("renders %s as %s", async (input, expected) => {
		await expect(make().format(input)).resolves.toBe(expected);
	});

	it("renders an answered date snapped and cased like the run", async () => {
		const formatter = make();
		(formatter as unknown as { variables: Map<string, unknown> }).variables.set("due", answered);
		await expect(
			formatter.format("{{VDATE:due,MMMM D|startof:month|case:upper|tomorrow|optional}}"),
		).resolves.toBe("AUGUST 1");
	});
});

describe("where the two previews differ", () => {
	it("hints at a default and an optional prompt only in the body", async () => {
		await expect(
			formatters.body().format("{{VDATE:due,YYYY-MM-DD|tomorrow|optional}}"),
		).resolves.toBe("2023-06-01 (default: tomorrow) (optional)");
		await expect(
			formatters.fileName().format("{{VDATE:due,YYYY-MM-DD|tomorrow|optional}}"),
		).resolves.toBe("2023-06-01");
	});

	it("falls back to the format pattern when the example cannot be rendered", async () => {
		vi.spyOn(DateFormatPreviewGenerator, "generate").mockImplementation(() => {
			throw new Error("no moment");
		});
		await expect(
			formatters.body().format("{{VDATE:due,YYYY|tomorrow}}"),
		).resolves.toBe("[YYYY format] (default: tomorrow)");
		await expect(
			formatters.fileName().format("{{VDATE:due,YYYY|tomorrow}}"),
		).resolves.toBe("[YYYY]");
	});

	it("reports a bad snap unit on a nameless token only in the body", async () => {
		const body = formatters.body();
		await expect(body.format("{{VDATE:,YYYY|startof:we}}")).resolves.toBe(
			"{{VDATE:,YYYY|startof:we}}",
		);
		const unitMessages = (formatter: { diagnostics: { list(): readonly { message: string }[] } }) =>
			formatter.diagnostics.list().filter((d) => d.message.includes('Unknown date unit "we"'));
		expect(unitMessages(body)).toHaveLength(1);

		const fileName = formatters.fileName();
		await expect(fileName.format("{{VDATE:,YYYY|startof:we}}")).resolves.toBe(
			"{{VDATE:,YYYY|startof:we}}",
		);
		expect(unitMessages(fileName)).toEqual([]);
	});
});
