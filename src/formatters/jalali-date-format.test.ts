import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Formatter } from "./formatter";

class TestFormatter extends Formatter {
	public variables = new Map<string, unknown>();
	private mockPromptValue = "";

	constructor() {
		super();
		this.dateParser = {
			parseDate: vi.fn(() => ({
				moment: {
					toISOString: () => "2026-05-28T12:00:00.000Z",
					isValid: () => true,
					format: (format: string) => `gregorian-${format}`,
				},
			})),
		};
	}

	public renderDates(input: string): string {
		return this.replaceDateInString(input);
	}

	public async renderVdates(input: string): Promise<string> {
		return await this.replaceDateVariableInString(input);
	}

	public setMockPromptValue(value: string): void {
		this.mockPromptValue = value;
	}

	protected async format(input: string): Promise<string> {
		return input;
	}

	protected getMacroValue(): string {
		return "";
	}

	protected async promptForVariable(variableName: string): Promise<string> {
		return this.mockPromptValue || `prompted-${variableName}`;
	}

	protected async getTemplateContent(): Promise<string> {
		return "";
	}

	protected suggestForValue(suggestedValues: string[]): string {
		return suggestedValues[0] ?? "";
	}

	protected async suggestForField(): Promise<string> {
		return "";
	}

	protected async promptForValue(): Promise<string> {
		return "";
	}

	protected getCurrentFileLink(): string | null {
		return null;
	}

	protected getCurrentFileName(): string | null {
		return null;
	}

	protected async promptForMathValue(): Promise<string> {
		return "";
	}

	protected getVariableValue(variableName: string): string {
		return String(this.variables.get(variableName) ?? "");
	}

	protected async getSelectedText(): Promise<string> {
		return "";
	}

	protected async getClipboardContent(): Promise<string> {
		return "";
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false;
	}
}

describe("Jalali date format syntax", () => {
	let formatter: TestFormatter;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-05-28T12:00:00.000Z"));
		formatter = new TestFormatter();
		(globalThis as any).window ??= globalThis;
		(globalThis as any).window.moment = vi.fn(() => ({
			add: vi.fn(function () { return this; }),
			format: (format: string) => `gregorian-${format}`,
			isValid: () => true,
		}));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("formats DATE with explicit Jalali calendar option", () => {
		expect(
			formatter.renderDates("{{DATE:jYYYY-jMM-jDD|calendar:jalali}}"),
		).toBe("1405-03-07");
	});

	it("does not infer Jalali formatting from j tokens", () => {
		expect(formatter.renderDates("{{DATE:jYYYY-jMM-jDD}}"))
			.toBe("gregorian-jYYYY-jMM-jDD");
	});

	it("formats VDATE stored ISO values with explicit Jalali calendar option", async () => {
		formatter.variables.set("due", "@date:2026-05-28T12:00:00.000Z");

		await expect(
			formatter.renderVdates("{{VDATE:due,jYYYY-jMM-jDD|calendar:jalali}}"),
		).resolves.toBe("1405-03-07");
	});

	it("preserves legacy VDATE shorthand defaults", async () => {
		await formatter.renderVdates("{{VDATE:due,YYYY-MM-DD|today}}");

		expect(formatter.variables.get("due")).toBe("@date:2026-05-28T12:00:00.000Z");
	});

	it("supports keyed VDATE defaults with calendar options", async () => {
		await expect(
			formatter.renderVdates(
				"{{VDATE:due,jYYYY-jMM-jDD|calendar:jalali|default:today}}",
			),
		).resolves.toBe("1405-03-07");
	});

	it("parses prompted Jalali input with the VDATE format", async () => {
		formatter.setMockPromptValue("1405-03-07");

		await expect(
			formatter.renderVdates("{{VDATE:due,jYYYY-jMM-jDD|calendar:jalali}}"),
		).resolves.toBe("1405-03-07");
	});

	it("coerces pre-seeded Jalali input with the VDATE format", async () => {
		formatter.variables.set("due", "1405-03-07");

		await expect(
			formatter.renderVdates("{{VDATE:due,jYYYY-jMM-jDD|calendar:jalali}}"),
		).resolves.toBe("1405-03-07");
	});
});
