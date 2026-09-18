import { StubFormatter as FormatterStub } from "../../tests/helpers/formatters/stubFormatter";
import { describe, it, expect, beforeEach } from "vitest";

// Regression tests for issue #920:
// - Entering `{{value}}` (or text containing it) into the VALUE prompt caused an infinite loop.
// - Entering `{{mvalue}}` into the math modal caused repeated prompting / non-termination.
class Issue920TestFormatter extends FormatterStub {
	private valueResponse = "";
	private mathResponse = "";

	public setValueResponse(value: string): void {
		this.valueResponse = value;
	}

	public setMathResponse(value: string): void {
		this.mathResponse = value;
	}

	protected async format(input: string): Promise<string> {
		let output = input;
		output = await this.replaceValueInString(output);
		output = await this.replaceMathValueInString(output);
		return output;
	}

	protected promptForValue(): string {
		return this.valueResponse;
	}

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve(this.mathResponse);
	}

	public async testFormat(input: string): Promise<string> {
		return await this.format(input);
	}
}

describe("Issue #920: VALUE/MVALUE self-references should not hang", () => {
	let formatter: Issue920TestFormatter;

	beforeEach(() => {
		formatter = new Issue920TestFormatter();
	});

	it("treats {{VALUE}} returned from the VALUE prompt as literal (no recursion)", async () => {
		formatter.setValueResponse("{{VALUE}}");
		const result = await formatter.testFormat("Start {{VALUE}} End");
		expect(result).toBe("Start {{VALUE}} End");
	});

	it("does not recursively expand {{VALUE}} inside user-provided VALUE input", async () => {
		formatter.setValueResponse("prefix {{VALUE}}");
		const result = await formatter.testFormat("A {{VALUE}} B {{VALUE}} C");
		expect(result).toBe("A prefix {{VALUE}} B prefix {{VALUE}} C");
	});

	it("treats {{MVALUE}} returned from the math prompt as literal (no recursion)", async () => {
		formatter.setMathResponse("{{MVALUE}}");
		const result = await formatter.testFormat("Start {{MVALUE}} End");
		expect(result).toBe("Start {{MVALUE}} End");
	});

	it("does not recursively expand {{MVALUE}} inside user-provided math input", async () => {
		formatter.setMathResponse("prefix {{MVALUE}}");
		const result = await formatter.testFormat("A {{MVALUE}} B");
		expect(result).toBe("A prefix {{MVALUE}} B");
	});
});
