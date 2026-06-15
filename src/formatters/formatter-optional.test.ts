import { beforeEach, describe, expect, it, vi } from "vitest";
import { Formatter, type PromptContext } from "./formatter";

/**
 * Issue #1259 — optional / skippable {{VALUE}} / {{VDATE}} prompts.
 * Exercises the REAL Formatter replace loops (not a re-implementation) with
 * stubbed prompt hooks, pinning the new semantics:
 *  - "" is an answered value for VDATE (undefined-aware gate, #872 parity)
 *  - optional tokens bypass default-on-empty
 *  - optional VDATE blank short-circuits before date parsing
 *  - required VDATE parse errors carry the |optional tip
 */

function installMomentStub(): void {
	const moment = vi.fn((input?: string) => ({
		format: (fmt = "YYYY-MM-DD") =>
			fmt === "[📅 ]YYYY-MM-DD" ? "📅 2026-06-14" : "2026-06-14",
		isValid: () => true,
		toISOString: () => input ?? "2026-06-14T00:00:00.000Z",
	})) as unknown as typeof window.moment;

	(globalThis as { window?: unknown }).window ??= globalThis;
	(globalThis as unknown as { window: { moment: unknown } }).window.moment =
		moment;
}

const PARSEABLE_DATES = new Set(["tomorrow", "2026-06-14"]);

class OptionalTestFormatter extends Formatter {
	public promptCalls: Array<{ name: string; context?: PromptContext }> = [];
	public suggestCalls: Array<{
		values: string[];
		context?: { optional?: boolean };
	}> = [];
	private responses = new Map<string, string>();

	constructor() {
		super();
		this.dateParser = {
			parseDate: (input: string) =>
				PARSEABLE_DATES.has(input?.trim())
					? {
							moment: {
								toISOString: () => "2026-06-14T00:00:00.000Z",
							},
						}
					: null,
		} as never;
	}

	public setResponse(key: string, value: string): void {
		this.responses.set(key, value);
	}

	public setVariable(name: string, value: unknown): void {
		this.variables.set(name, value);
	}

	public getVariable(name: string): unknown {
		return this.variables.get(name);
	}

	public async run(input: string): Promise<string> {
		return await this.format(input);
	}

	protected async format(input: string): Promise<string> {
		let output = input;
		output = await this.replaceDateVariableInString(output);
		output = await this.replaceVariableInString(output);
		return output;
	}

	protected promptForValue(): string {
		return "";
	}

	protected async promptForVariable(
		name: string,
		context?: PromptContext,
	): Promise<string> {
		this.promptCalls.push({ name, context });
		return this.responses.get(name) ?? "";
	}

	protected suggestForValue(
		suggestedValues: string[],
		_allowCustomInput?: boolean,
		context?: { optional?: boolean },
	): string {
		this.suggestCalls.push({ values: suggestedValues, context });
		return this.responses.get(suggestedValues.join(",")) ?? "";
	}

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	protected getCurrentFileLink(): string | null {
		return null;
	}
	protected getCurrentFileName(): string | null {
		return null;
	}
	protected suggestForFile(): string {
		return "";
	}

	protected async suggestForField(): Promise<string> {
		return "";
	}
	protected async promptForMathValue(): Promise<string> {
		return "";
	}
	protected async getMacroValue(): Promise<string> {
		return "";
	}
	protected async getTemplateContent(): Promise<string> {
		return "";
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

describe("optional {{VALUE}} tokens (issue #1259)", () => {
	let formatter: OptionalTestFormatter;

	beforeEach(() => {
		installMomentStub();
		formatter = new OptionalTestFormatter();
	});

	it("keeps an empty submission instead of the default for optional tokens", async () => {
		formatter.setResponse("note", "");
		const result = await formatter.run("[{{VALUE:note|default:Hi|optional}}]");
		expect(result).toBe("[]");
		expect(formatter.getVariable("note")).toBe("");
	});

	it("passes shorthand default plus optional flag to the prompt", async () => {
		formatter.setResponse("note", "");
		const result = await formatter.run("[{{VALUE:note|Hi|optional}}]");
		expect(result).toBe("[]");
		expect(formatter.promptCalls[0]?.context).toMatchObject({
			defaultValue: "Hi",
			optional: true,
		});
	});

	it("keeps default-wins-on-empty for required tokens (existing pin)", async () => {
		formatter.setResponse("note", "");
		const result = await formatter.run("[{{VALUE:note|Hi}}]");
		expect(result).toBe("[Hi]");
	});

	it("treats keyed optional:false as required", async () => {
		formatter.setResponse("note", "");
		const result = await formatter.run(
			"[{{VALUE:note|optional:false|default:Hi}}]",
		);
		expect(result).toBe("[Hi]");
	});

	it("prompts once and renders all occurrences empty after an optional skip", async () => {
		formatter.setResponse("note", "");
		const result = await formatter.run(
			"[{{VALUE:note|optional}}][{{VALUE:note}}]",
		);
		expect(result).toBe("[][]");
		expect(formatter.promptCalls).toHaveLength(1);
	});

	it("threads the optional flag into option-list suggesters", async () => {
		formatter.setResponse("a,b", "");
		const result = await formatter.run("[{{VALUE:a,b|optional}}]");
		expect(result).toBe("[]");
		expect(formatter.suggestCalls[0]?.context?.optional).toBe(true);
	});
});

describe("optional {{VDATE}} tokens and the '' contract (issue #1259)", () => {
	let formatter: OptionalTestFormatter;

	beforeEach(() => {
		installMomentStub();
		formatter = new OptionalTestFormatter();
	});

	it("renders a script-set '' as empty without prompting (JamesKF fix)", async () => {
		formatter.setVariable("due", "");
		const result = await formatter.run("[{{VDATE:due,YYYY-MM-DD}}]");
		expect(result).toBe("[]");
		expect(formatter.promptCalls).toHaveLength(0);
	});

	it("keeps the legacy ' ' workaround byte-identical", async () => {
		formatter.setVariable("due", " ");
		const result = await formatter.run("[{{VDATE:due,YYYY-MM-DD}}]");
		expect(result).toBe("[ ]");
		expect(formatter.promptCalls).toHaveLength(0);
	});

	it("stores '' when an optional date is left blank", async () => {
		formatter.setResponse("due", "");
		const result = await formatter.run("[{{VDATE:due,YYYY-MM-DD|optional}}]");
		expect(result).toBe("[]");
		expect(formatter.getVariable("due")).toBe("");
		expect(formatter.promptCalls[0]?.context).toMatchObject({
			type: "VDATE",
			optional: true,
			dateFormat: "YYYY-MM-DD",
		});
	});

	it("does not resurrect the default when an optional date is cleared", async () => {
		formatter.setResponse("due", "");
		const result = await formatter.run(
			"[{{VDATE:due,YYYY-MM-DD|tomorrow|optional}}]",
		);
		expect(result).toBe("[]");
		expect(formatter.promptCalls[0]?.context?.defaultValue).toBe("tomorrow");
	});

	it("still throws on unparseable non-blank input for optional dates (typo protection)", async () => {
		formatter.setResponse("due", "tomorow");
		await expect(
			formatter.run("[{{VDATE:due,YYYY-MM-DD|optional}}]"),
		).rejects.toThrow(/unable to parse date variable tomorow(?!.*Tip:)/);
	});

	it("adds the |optional tip to required-date parse errors", async () => {
		formatter.setResponse("due", "");
		await expect(
			formatter.run("[{{VDATE:due,YYYY-MM-DD}}]"),
		).rejects.toThrow(/Tip: add \|optional/);
	});

	it("prompts once and renders every occurrence empty after a skip", async () => {
		formatter.setResponse("due", "");
		const result = await formatter.run(
			"[{{VDATE:due,YYYY-MM-DD|optional}}][{{VDATE:due,gggg-[W]WW}}]",
		);
		expect(result).toBe("[][]");
		expect(formatter.promptCalls).toHaveLength(1);
	});

	it("renders bracket-literal decoration only when the date is answered", async () => {
		formatter.setResponse("due", "2026-06-14");
		const answered = await formatter.run(
			"[{{VDATE:due,[📅 ]YYYY-MM-DD|optional}}]",
		);
		expect(answered).toBe("[📅 2026-06-14]");

		const skipped = new OptionalTestFormatter();
		skipped.setResponse("due", "");
		const result = await skipped.run(
			"[{{VDATE:due,[📅 ]YYYY-MM-DD|optional}}]",
		);
		expect(result).toBe("[]");
	});
});

describe("undefined-aware VDATE gate edge values (#872 parity)", () => {
	beforeEach(() => {
		installMomentStub();
	});

	it("renders stored 0 and false without prompting", async () => {
		const zero = new OptionalTestFormatter();
		zero.setVariable("due", 0);
		expect(await zero.run("[{{VDATE:due,YYYY-MM-DD}}]")).toBe("[0]");
		expect(zero.promptCalls).toHaveLength(0);

		const falsy = new OptionalTestFormatter();
		falsy.setVariable("due", false);
		expect(await falsy.run("[{{VDATE:due,YYYY-MM-DD}}]")).toBe("[false]");
		expect(falsy.promptCalls).toHaveLength(0);
	});

	it("renders stored null as empty without prompting", async () => {
		const formatter = new OptionalTestFormatter();
		formatter.setVariable("due", null);
		expect(await formatter.run("[{{VDATE:due,YYYY-MM-DD}}]")).toBe("[]");
		expect(formatter.promptCalls).toHaveLength(0);
	});
});

describe("VDATE replacement treats stored values literally", () => {
	beforeEach(() => {
		installMomentStub();
	});

	it("does not re-expand $-patterns from pre-seeded values (no infinite loop)", async () => {
		const formatter = new OptionalTestFormatter();
		formatter.setVariable("due", "cost $& due");
		const result = await formatter.run("[{{VDATE:due,YYYY-MM-DD}}]");
		expect(result).toBe("[cost $& due]");

		const dollars = new OptionalTestFormatter();
		dollars.setVariable("due", "5$$");
		expect(await dollars.run("[{{VDATE:due,YYYY-MM-DD}}]")).toBe("[5$$]");
	});
});
