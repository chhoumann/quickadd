import { afterAll, beforeAll, describe, expect, it } from "vitest";
import moment from "moment";
import { StubFormatter } from "../../tests/helpers/formatters/stubFormatter";
import { createMockApp } from "../../tests/helpers/formatters/captureFixtures";
import { createCaptureFormatterPlugin } from "../../tests/helpers/formatters/plugin";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";

const originalMoment = window.moment;
beforeAll(() => { window.moment = moment; });
afterAll(() => { window.moment = originalMoment; });

class DateFormatter extends StubFormatter {
	constructor() {
		super();
		this.dateParser = { parseDate: () => null };
	}
	protected async promptForVariable(): Promise<string> {
		return "@date:2026-09-16T12:00:00";
	}
	public render(input: string): Promise<string> {
		return this.replaceDateVariableInString(input);
	}
}

describe("Formatter - VDATE Comma Crash Prevention", () => {
	it.each([
		["should not crash on {{VDATE:, pattern", "Test {{VDATE:,", "Test {{VDATE:,"],
		["should not crash on {{VDATE:, }} pattern", "Test {{VDATE:, }}", "Test {{VDATE:, }}"],
		["should not crash on {{VDATE:var, pattern", "Test {{VDATE:var,", "Test {{VDATE:var,"],
		["should not crash on {{VDATE:var,}} pattern", "Test {{VDATE:var,}}", "Test 2026-09-16"],
		["should not crash on {{VDATE:,format}} pattern", "Test {{VDATE:,format}}", "Test {{VDATE:,format}}"],
		["should process valid VDATE pattern", "Test {{VDATE:myDate,YYYY-MM-DD}}", "Test 2026-09-16"],
		["should handle multiple valid VDATE patterns", "{{VDATE:date1,YYYY}} and {{VDATE:date2,MM-DD}}", "2026 and 09-16"],
		["should handle whitespace in VDATE pattern", "Test {{VDATE: myDate , YYYY-MM-DD }}", "Test 2026-09-16"],
		["should handle format with comma inside", "Test {{VDATE:date,MMM D}}", "Test Sep 16"],
		["should not enter infinite loop with malformed patterns", "{{VDATE:{{VDATE:,}}", "{{VDATE:{{VDATE:,}}"],
		["should handle empty string input", "", ""],
		["should support commas in date format patterns", "{{VDATE:myDate,MMM D, YYYY}}", "Sep 16, 2026"],
		["should handle multiple commas in date format", "{{VDATE:event,YYYY, MMM D, dddd}}", "2026, Sep 16, Wednesday"],
		["should work with trailing commas", "{{VDATE:test,YYYY,}}", "2026,"],
	])("%s", async (_name, input, expected) => {
		await expect(new DateFormatter().render(input)).resolves.toBe(expected);
	});

	it("should wrap format method in try-catch", async () => {
		class FailedPreview extends FormatDisplayFormatter {
			protected replaceDateInString(): string { throw new Error("preview failure"); }
		}
		const formatter = new FailedPreview(createMockApp(), createCaptureFormatterPlugin());
		await expect(formatter.format("{{DATE}}")).resolves.toBe("{{DATE}}");
		expect(formatter.diagnostics.hasError).toBe(true);
	});
});
