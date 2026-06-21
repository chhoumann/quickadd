import { beforeEach, describe, expect, it, vi } from "vitest";

const { logWarningMock } = vi.hoisted(() => ({
	logWarningMock: vi.fn(),
}));

vi.mock("../logger/logManager", () => ({
	log: {
		logWarning: logWarningMock,
		logError: vi.fn(),
		logMessage: vi.fn(),
	},
}));

import { FieldSuggestionParser } from "./FieldSuggestionParser";

describe("FieldSuggestionParser - unknown filter feedback (integrations audit)", () => {
	beforeEach(() => {
		logWarningMock.mockReset();
	});

	it("warns when a pipe key is misspelled / unrecognized (FIELD grammar opts in)", () => {
		const result = FieldSuggestionParser.parse("status|exclud-tag:draft", {
			warnUnknown: true,
		});

		// The typo is still dropped (no filter applied)...
		expect(result.filters.excludeTags).toBeUndefined();
		// ...but the {{FIELD}} caller now gets a warning instead of silent nothing.
		expect(logWarningMock).toHaveBeenCalledTimes(1);
		expect(logWarningMock.mock.calls[0][0]).toContain("exclud-tag");
	});

	it("stays SILENT for shared callers (FILE/property/capture) on unknown keys", () => {
		// The parser is shared by the {{FILE:...|label:/name:}}, property:, and
		// capture-scope grammars, which legitimately carry keys this parser does
		// not recognize. Without warnUnknown it must not emit a false
		// "Unknown FIELD filter" notice or leak internal sentinels.
		FieldSuggestionParser.parse("People|link|label:Pick a person|name:reviewer");
		FieldSuggestionParser.parse("__capture_scope|folder:Work|fodler:Other");

		expect(logWarningMock).not.toHaveBeenCalled();
	});

	it("does not warn for recognized filters", () => {
		FieldSuggestionParser.parse(
			"status|folder:Work|tag:project|exclude-folder:Archive|default:Todo|case-sensitive:true|multi",
		);

		expect(logWarningMock).not.toHaveBeenCalled();
	});

	it("does not warn for colon-less invalid parts (existing skip behavior)", () => {
		const result = FieldSuggestionParser.parse("status|invalidfilter");

		expect(result.filters).toEqual({});
		expect(logWarningMock).not.toHaveBeenCalled();
	});
});
