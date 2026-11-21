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

import { FieldSuggestionParser, parseFilterSegments } from "./FieldSuggestionParser";
import { NOTICE_WARN } from "./warnSink";

describe("FieldSuggestionParser - unknown filter feedback (integrations audit)", () => {
	beforeEach(() => {
		logWarningMock.mockReset();
	});

	it("warns when a pipe key is misspelled / unrecognized (FIELD grammar opts in)", () => {
		const result = FieldSuggestionParser.parse("status|exclud-tag:draft", {
			warn: NOTICE_WARN,
		});

		// The typo is still dropped (no filter applied)...
		expect(result.filters.excludeTags).toBeUndefined();
		// ...but the {{FIELD}} caller now gets a warning instead of silent nothing.
		expect(logWarningMock).toHaveBeenCalledTimes(1);
		expect(logWarningMock.mock.calls[0][0]).toContain("exclud-tag");
	});

	it("stays SILENT for shared callers (FILE/property/capture) on unknown keys", () => {
		// The segment grammar is shared by the {{FILE:...|type:}}, property:, and
		// capture-scope grammars, which legitimately carry keys FIELD does not
		// recognize. They must not get a false "Unknown FIELD filter" notice,
		// even while value mistakes still reach their sink.
		parseFilterSegments(["link", "type:pdf", "label:Pick a person"], {
			token: "{{FILE:People|link|type:pdf|label:Pick a person}}",
			warn: NOTICE_WARN,
		});
		parseFilterSegments(["folder:Work", "fodler:Other"], {
			token: "folder:Work|fodler:Other",
			warn: NOTICE_WARN,
		});

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
