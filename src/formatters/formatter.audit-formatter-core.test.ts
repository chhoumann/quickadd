import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Formatter, type PromptContext } from "./formatter";
import { log } from "../logger/logManager";

/**
 * Regression tests for the formatter-core audit fixes that live in
 * src/formatters/formatter.ts. Only the abstract UI/IO hooks are stubbed so the
 * REAL replacer methods run.
 */
class TestFormatter extends Formatter {
	public selectedText = "";
	public vdatePrompts: string[] = [];
	private vdateResponse = "";

	constructor() {
		super(undefined);
		//@ts-ignore minimal date parser stub
		this.dateParser = {
			parseDate: (input: string) =>
				input
					? {
							moment: {
								format: () => "2025-06-21",
								toISOString: () => "2025-06-21T00:00:00.000Z",
								isValid: () => true,
							},
						}
					: null,
		};
	}

	public setVDateResponse(value: string): void {
		this.vdateResponse = value;
	}

	public runSelected(input: string): Promise<string> {
		return this.replaceSelectedInString(input);
	}

	public runDateVariable(input: string): Promise<string> {
		return this.replaceDateVariableInString(input);
	}

	public runVariable(input: string): Promise<string> {
		return this.replaceVariableInString(input);
	}

	public runValue(input: string): Promise<string> {
		return this.replaceValueInString(input);
	}

	public setValue(value: string | undefined): void {
		//@ts-ignore protected
		this.value = value;
	}

	protected async format(input: string): Promise<string> {
		return input;
	}
	protected async promptForValue(): Promise<string> {
		return "";
	}
	protected async promptForVariable(
		variableName: string,
		context?: PromptContext,
	): Promise<string> {
		if (context?.type === "VDATE") {
			this.vdatePrompts.push(variableName);
			return this.vdateResponse;
		}
		return `typed(${variableName})`;
	}
	protected async suggestForValue(
		suggestedValues: string[],
	): Promise<string> {
		return suggestedValues[0] ?? "";
	}
	protected suggestForFile(): string {
		return "";
	}
	protected async suggestForField(): Promise<string> {
		return "";
	}
	protected async getMacroValue(): Promise<string> {
		return "";
	}
	protected async getTemplateContent(): Promise<string> {
		return "";
	}
	protected async getSelectedText(): Promise<string> {
		return this.selectedText;
	}
	protected async getClipboardContent(): Promise<string> {
		return "";
	}
	protected getCurrentFileLink(): string | null {
		return null;
	}
	protected getCurrentFileName(): string | null {
		return null;
	}
	protected getVariableValue(variableName: string): string {
		return String(this.variables.get(variableName) ?? "");
	}
	protected async promptForMathValue(): Promise<string> {
		return "";
	}
	protected isTemplatePropertyTypesEnabled(): boolean {
		return false;
	}
}

let previousMoment: unknown;

beforeEach(() => {
	(globalThis as any).window ??= globalThis;
	previousMoment = (globalThis as any).window.moment;
	(globalThis as any).window.moment = (_iso?: unknown) => ({
		isValid: () => true,
		format: (fmt?: string) => `[${fmt}]`,
	});
});

afterEach(() => {
	// Restore the prior global so this stub doesn't bleed into later suites.
	(globalThis as any).window.moment = previousMoment;
	vi.restoreAllMocks();
});

describe("{{SELECTED}} self-reference (format-core-selected-token)", () => {
	it("does not loop when the selection literally contains {{SELECTED}}", async () => {
		const f = new TestFormatter();
		// A selection that re-contains the token would loop forever with the old
		// re-scanning while-loop; the single-pass replacer inserts it literally.
		f.selectedText = "before {{SELECTED}} after";

		const out = await f.runSelected("[{{SELECTED}}]");

		expect(out).toBe("[before {{SELECTED}} after]");
	});

	it("replaces every occurrence in one pass", async () => {
		const f = new TestFormatter();
		f.selectedText = "X";
		expect(await f.runSelected("{{SELECTED}}-{{SELECTED}}")).toBe("X-X");
	});

	it("returns the input unchanged when no token is present", async () => {
		const f = new TestFormatter();
		f.selectedText = "X";
		expect(await f.runSelected("no token here")).toBe("no token here");
	});
});

describe("{{VDATE}} malformed-token skip (value-syntax-vdate-prompt)", () => {
	it("a leading empty-name {{VDATE:}} does not block a later valid {{VDATE}}", async () => {
		const f = new TestFormatter();
		f.setVDateResponse("2025-06-21");

		const out = await f.runDateVariable(
			"{{VDATE:,YYYY}} and {{VDATE:due,YYYY-MM-DD}}",
		);

		// The malformed token is left literal; the valid one still prompts + renders.
		expect(out).toBe("{{VDATE:,YYYY}} and [YYYY-MM-DD]");
		expect(f.vdatePrompts).toEqual(["due"]);
	});

	it("a malformed {{VDATE:,fmt}} after a valid one still leaves the valid one resolved", async () => {
		const f = new TestFormatter();
		f.setVDateResponse("2025-06-21");

		const out = await f.runDateVariable(
			"{{VDATE:due,YYYY-MM-DD}} then {{VDATE:,YYYY}}",
		);

		expect(out).toBe("[YYYY-MM-DD] then {{VDATE:,YYYY}}");
		expect(f.vdatePrompts).toEqual(["due"]);
	});
});

describe("anonymous {{VALUE|default:X}} on empty submission (value-syntax-anonymous-value)", () => {
	it("applies the default when the submission is empty and not optional", async () => {
		const f = new TestFormatter();
		f.setValue(""); // user cleared the pre-filled box

		expect(await f.runValue("[{{VALUE|default:Hi}}]")).toBe("[Hi]");
	});

	it("does NOT apply the default for an |optional empty submission", async () => {
		const f = new TestFormatter();
		f.setValue("");

		expect(await f.runValue("[{{VALUE|default:Hi|optional}}]")).toBe("[]");
	});

	it("a provided value still wins over the default", async () => {
		const f = new TestFormatter();
		f.setValue("typed");

		expect(await f.runValue("[{{VALUE|default:Hi}}]")).toBe("[typed]");
	});
});

describe("named-value option-list conflict surfaces a Notice (format-core-value-named-alias)", () => {
	it("routes the conflict warning through log.logWarning (on-screen Notice)", async () => {
		const warnSpy = vi
			.spyOn(log, "logWarning")
			.mockImplementation(() => {});
		const f = new TestFormatter();

		await f.runVariable(
			"a={{VALUE:bug,feature|name:type}} b={{VALUE:book,movie|name:type}}",
		);

		expect(
			warnSpy.mock.calls.some((c) =>
				String(c[0]).includes("different option lists"),
			),
		).toBe(true);
	});
});
