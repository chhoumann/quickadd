import realMoment from "moment";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Formatter, type PromptContext } from "./formatter";

// Integration test for the issue #511 snap wiring THROUGH the formatter passes
// (not just the regex/unit helpers). Uses real moment + a frozen clock so the
// rendered output is deterministic. en locale = Sunday-first week.
const originalMoment = (window as unknown as { moment?: unknown }).moment;
const previousLocale = realMoment.locale();

beforeAll(() => {
	realMoment.locale("en");
	(window as unknown as { moment: unknown }).moment = realMoment;
});
afterAll(() => {
	(window as unknown as { moment?: unknown }).moment = originalMoment;
	realMoment.locale(previousLocale);
	vi.useRealTimers();
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2023-06-01T12:00:00")); // Thursday
});

class TestFormatter extends Formatter {
	public readonly warnings: string[] = [];

	constructor() {
		super();
		// Truthy so the @date: format branch in replaceDateVariableInString runs;
		// parseDate is never called for a pre-seeded @date: value.
		this.dateParser = { parseDate: () => null } as never;
	}
	public seed(name: string, value: unknown) {
		this.variables.set(name, value);
	}
	public renderDate(input: string) {
		return this.replaceDateInString(input);
	}
	public renderTime(input: string) {
		return this.replaceTimeInString(input);
	}
	public renderVDate(input: string) {
		return this.replaceDateVariableInString(input);
	}
	protected async format(input: string) {
		return input;
	}
	protected promptForValue(): string {
		return "";
	}
	protected getCurrentFileLink() {
		return null;
	}
	protected getCurrentFileName() {
		return null;
	}
	protected suggestForFile() {
		return "";
	}
	protected async promptForMathValue() {
		return "";
	}
	protected getVariableValue(name: string): string {
		const v = this.variables.get(name);
		return v == null ? "" : String(v);
	}
	protected suggestForValue() {
		return "";
	}
	protected async suggestForField() {
		return "";
	}
	protected getMacroValue() {
		return "";
	}
	protected async promptForVariable(_n: string, _c?: PromptContext) {
		return "";
	}
	protected async getTemplateContent() {
		return "";
	}
	protected async getSelectedText() {
		return "";
	}
	protected async getClipboardContent() {
		return "";
	}
	protected isTemplatePropertyTypesEnabled() {
		return false;
	}
	protected warn(message: string): void {
		this.warnings.push(message);
	}
}

describe("{{DATE}} snap through replaceDateInString", () => {
	let f: TestFormatter;
	beforeEach(() => {
		f = new TestFormatter();
	});

	it("renders the #511 week-snapped filename and leaves naive DATE/heading alone", () => {
		expect(f.renderDate("{{DATE:gggg.MM.[Wk]w|startof:week}}")).toBe("2023.05.Wk22");
		expect(f.renderDate("{{DATE:gggg.MM.[Wk]w}}")).toBe("2023.06.Wk22");
		expect(f.renderDate("{{DATE:M.DD dddd}}")).toBe("6.01 Thursday");
	});

	it("renders endof:month and offset-then-snap", () => {
		expect(f.renderDate("{{DATE:YYYY-MM-DD|endof:month}}")).toBe("2023-06-30");
		expect(f.renderDate("{{DATE:YYYY-MM-DD+7|startof:week}}")).toBe("2023-06-04");
	});

	it("keeps a literal pipe byte-identical and a [literal |startof: x] intact", () => {
		expect(f.renderDate("{{DATE:YYYY|MM}}")).toBe("2023|06");
		expect(
			f.renderDate("{{DATE:[x |startof: y ]YYYY-MM-DD|startof:month}}"),
		).toBe("x |startof: y 2023-06-01");
	});

	it("throws (does not silently no-op) on an unknown unit", () => {
		expect(() => f.renderDate("{{DATE:YYYY|startof:fortnight}}")).toThrowError(
			/Valid units/,
		);
	});
});

describe("{{VDATE}} snap through replaceDateVariableInString", () => {
	it("snaps per-occurrence: one picked date, filename snapped + heading day-actual", async () => {
		const f = new TestFormatter();
		f.seed("d", "@date:2023-06-01T12:00:00"); // Thursday
		const out = await f.renderVDate(
			"{{VDATE:d,gggg.MM.[Wk]w|startof:week}} :: {{VDATE:d,M.DD dddd}}",
		);
		expect(out).toBe("2023.05.Wk22 :: 6.01 Thursday");
	});
});

describe("date and time case transforms", () => {
	it("lowercases the reporter's exact DATE heading after locale formatting", () => {
		vi.setSystemTime(new Date("2026-08-11T12:00:00"));
		const f = new TestFormatter();
		expect(
			f.renderDate("## {{DATE:dddd, MMMM Do, yyyy.|case:lower}}"),
		).toBe("## tuesday, august 11th, 2026.");
	});

	it("preserves the active Moment locale before applying Unicode casing", () => {
		vi.setSystemTime(new Date("2026-08-11T12:00:00"));
		realMoment.locale("da");
		try {
			const f = new TestFormatter();
			expect(f.renderDate("{{DATE:dddd, MMMM|case:lower}}"))
				.toBe("tirsdag, august");
		} finally {
			realMoment.locale("en");
		}
	});

	it("composes a date snap before the per-occurrence case transform", () => {
		const f = new TestFormatter();
		expect(
			f.renderDate(
				"raw={{DATE:MMMM YYYY|startof:month}} lower={{DATE:MMMM YYYY|startof:month|case:lower}}",
			),
		).toBe("raw=June 2023 lower=june 2023");
	});

	it("applies the same explicit transform to TIME and VDATE output", async () => {
		const f = new TestFormatter();
		f.seed("d", "@date:2026-08-11T12:00:00");

		expect(f.renderTime("{{TIME:A|case:lower}}")).toBe("pm");
		await expect(
			f.renderVDate("{{VDATE:d,dddd, MMMM Do, yyyy.|case:lower}}"),
		).resolves.toBe("tuesday, august 11th, 2026.");
	});

	it("preserves literal pipes in TIME formats and brackets case-like literals", () => {
		const f = new TestFormatter();
		expect(f.renderTime("{{TIME:HH|mm}}"))
			.toBe("12|00");
		expect(f.renderTime("{{TIME:HH[|case:lower]}}"))
			.toBe("12|case:lower");
	});

	it("warns and leaves output unchanged for an unknown case style", () => {
		const f = new TestFormatter();
		expect(f.renderDate("{{DATE:MMMM|case:lowre}}")).toBe("June");
		expect(f.warnings).toEqual([
			'QuickAdd: Unsupported |case style "lowre" in token "{{DATE:MMMM|case:lowre}}". Supported styles: kebab, snake, camel, pascal, title, lower, upper, slug.',
		]);
	});
});
