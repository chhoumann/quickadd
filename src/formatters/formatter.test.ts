import { describe, it, expect, beforeEach } from "vitest";

// Create a test implementation of the abstract Formatter class
class TestFormatter {
	protected variables: Map<string, unknown> = new Map();
	private promptCalled = false;

	protected getVariableValue(variableName: string): string {
		// This is the fix we're testing
		return (this.variables.get(variableName) as string) ?? "";
	}

	/** Returns true when a variable is present AND its value is neither undefined nor null.
	 *  An empty string is considered a valid, intentional value. */
	protected hasConcreteVariable(name: string): boolean {
		if (!this.variables.has(name)) return false;
		const v = this.variables.get(name);
		return v !== undefined && v !== null;
	}

	protected async promptForVariable(_variableName: string): Promise<string> {
		this.promptCalled = true;
		return "prompted_value";
	}

	// Mock implementation of variable replacement for testing
	async testReplaceVariableInString(input: string): Promise<string> {
		this.promptCalled = false;
		let output: string = input;
		const VARIABLE_REGEX = /\{\{VALUE:([^}]+)\}\}/;

		while (VARIABLE_REGEX.test(output)) {
			const match = VARIABLE_REGEX.exec(output);
			if (!match) break;

			let variableName = match[1];
			let defaultValue = "";

			if (variableName) {
				// Parse default value if present (syntax: {{VALUE:name|default}})
				const pipeIndex = variableName.indexOf("|");
				if (pipeIndex !== -1) {
					defaultValue = variableName.substring(pipeIndex + 1).trim();
					variableName = variableName.substring(0, pipeIndex).trim();
				}

				if (!this.hasConcreteVariable(variableName)) {
					let variableValue = await this.promptForVariable(variableName);

					// Use default value if no input provided
					if (!variableValue && defaultValue) {
						variableValue = defaultValue;
					}

					this.variables.set(variableName, variableValue);
				}

				// Replace using replacer pattern like the actual implementation
				output = output.replace(match[0], this.getVariableValue(variableName));
			} else {
				break;
			}
		}

		return output;
	}

	protected replaceLinebreakInString(input: string): string {
		let output = "";

		for (let i = 0; i < input.length; i++) {
			const curr = input[i];
			const next = input[i + 1];

			if (curr === "\\") {
				if (next === "n") {
					output += "\n";
					i++;
				} else if (next === "\\") {
					output += "\\";
					i++;
				} else {
					// Invalid use of escape character, but we keep it anyway.
					output += "\\";
				}
			} else {
				output += curr;
			}
		}

		return output;
	}

	// Expose for testing
	public testGetVariableValue(variableName: string): string {
		return this.getVariableValue(variableName);
	}

	public testReplaceLinebreakInString(input: string): string {
		return this.replaceLinebreakInString(input);
	}

	public setVariable(name: string, value: unknown) {
		this.variables.set(name, value);
	}

	public wasPromptCalled(): boolean {
		return this.promptCalled;
	}

	public resetPromptCalled() {
		this.promptCalled = false;
	}
}

describe("Formatter - Variable Handling", () => {
	let formatter: TestFormatter;

	beforeEach(() => {
		formatter = new TestFormatter();
	});

	describe("getVariableValue", () => {
		it("should return empty string for undefined variables", () => {
			formatter.setVariable("testVar", undefined);
			const result = formatter.testGetVariableValue("testVar");
			expect(result).toBe("");
		});

		it("should return empty string for non-existent variables", () => {
			const result = formatter.testGetVariableValue("nonExistent");
			expect(result).toBe("");
		});

		it("should return empty string for null variables", () => {
			formatter.setVariable("nullVar", null);
			const result = formatter.testGetVariableValue("nullVar");
			expect(result).toBe("");
		});

		it("should return the actual value for existing string variables", () => {
			formatter.setVariable("stringVar", "Hello World");
			const result = formatter.testGetVariableValue("stringVar");
			expect(result).toBe("Hello World");
		});

		it("should preserve empty string values", () => {
			formatter.setVariable("emptyVar", "");
			const result = formatter.testGetVariableValue("emptyVar");
			expect(result).toBe("");
		});
	});

	describe("Issue #163 - Empty string variables should not trigger prompts", () => {
		it("should not prompt when variable exists but is empty string", async () => {
			formatter.setVariable("myRating", "");
			const result = await formatter.testReplaceVariableInString(
				"Rating: {{VALUE:myRating}}"
			);
			expect(result).toBe("Rating: ");
			expect(formatter.wasPromptCalled()).toBe(false);
		});

		it("should prompt when variable does not exist", async () => {
			const result = await formatter.testReplaceVariableInString(
				"Rating: {{VALUE:nonExistent}}"
			);
			expect(result).toBe("Rating: prompted_value");
			expect(formatter.wasPromptCalled()).toBe(true);
		});

		it("should prompt when variable is undefined", async () => {
			formatter.setVariable("undefinedVar", undefined);
			const result = await formatter.testReplaceVariableInString(
				"Rating: {{VALUE:undefinedVar}}"
			);
			expect(result).toBe("Rating: prompted_value");
			expect(formatter.wasPromptCalled()).toBe(true);
		});

		it("should prompt when variable is null", async () => {
			formatter.setVariable("nullVar", null);
			const result = await formatter.testReplaceVariableInString(
				"Rating: {{VALUE:nullVar}}"
			);
			expect(result).toBe("Rating: prompted_value");
			expect(formatter.wasPromptCalled()).toBe(true);
		});

		it("should preserve non-empty string values without prompting", async () => {
			formatter.setVariable("ratedMovie", "8/10");
			const result = await formatter.testReplaceVariableInString(
				"Rating: {{VALUE:ratedMovie}}"
			);
			expect(result).toBe("Rating: 8/10");
			expect(formatter.wasPromptCalled()).toBe(false);
		});

		it('should preserve the string "0"', () => {
			formatter.setVariable("zeroString", "0");
			const result = formatter.testGetVariableValue("zeroString");
			expect(result).toBe("0");
		});

		it('should preserve the string "false"', () => {
			formatter.setVariable("falseString", "false");
			const result = formatter.testGetVariableValue("falseString");
			expect(result).toBe("false");
		});
	});

	describe("Edge cases that caused the bug", () => {
		it("should handle variables set by macros that return undefined", () => {
			// Simulating a macro that doesn't return anything
			const macroResult = undefined;
			formatter.setVariable("macroVar", macroResult);

			const result = formatter.testGetVariableValue("macroVar");
			expect(result).toBe("");
			expect(result).not.toBe("undefined");
		});

		it("should handle variables from empty user input", () => {
			// Simulating user pressing Enter without typing anything
			const userInput = "";
			formatter.setVariable("userVar", userInput);

			const result = formatter.testGetVariableValue("userVar");
			expect(result).toBe("");
		});

		it("should handle chain of undefined variables", () => {
			// var1 is undefined, var2 gets value from var1
			formatter.setVariable("var1", undefined);
			const var1Value = formatter.testGetVariableValue("var1");
			formatter.setVariable("var2", var1Value);

			const result = formatter.testGetVariableValue("var2");
			expect(result).toBe("");
			expect(result).not.toBe("undefined");
		});
	});
});

describe("Formatter - replaceLinebreakInString", () => {
	let formatter: TestFormatter;

	beforeEach(() => {
		formatter = new TestFormatter();
	});

	describe("Basic linebreak replacement", () => {
		it("should replace \\n with actual newline", () => {
			const result = formatter.testReplaceLinebreakInString("Line1\\nLine2");
			expect(result).toBe("Line1\nLine2");
		});

		it("should replace multiple \\n sequences", () => {
			const result = formatter.testReplaceLinebreakInString("Line1\\n\\nLine2");
			expect(result).toBe("Line1\n\nLine2");
		});

		it("should handle text without escape sequences", () => {
			const result = formatter.testReplaceLinebreakInString("No escapes here");
			expect(result).toBe("No escapes here");
		});

		it("should handle empty string", () => {
			const result = formatter.testReplaceLinebreakInString("");
			expect(result).toBe("");
		});
	});

	describe("Escape sequence handling", () => {
		it("should replace \\\\ with single backslash", () => {
			const result = formatter.testReplaceLinebreakInString("Line1\\\\Line2");
			expect(result).toBe("Line1\\Line2");
		});

		it("should handle mixed escape sequences", () => {
			const result = formatter.testReplaceLinebreakInString(
				"Line1\\nLine2\\\\Line3"
			);
			expect(result).toBe("Line1\nLine2\\Line3");
		});

		it("should handle invalid escape sequences", () => {
			const result = formatter.testReplaceLinebreakInString("Line1\\tLine2");
			expect(result).toBe("Line1\\tLine2");
		});

		it("should handle trailing backslash", () => {
			const result = formatter.testReplaceLinebreakInString("Line1\\");
			expect(result).toBe("Line1\\");
		});
	});

	describe("Complex escape sequences", () => {
		it("should handle \\\\n as escaped backslash followed by n", () => {
			const result = formatter.testReplaceLinebreakInString("Line1\\\\nLine2");
			expect(result).toBe("Line1\\nLine2");
		});

		it("should handle \\\\\\n as escaped backslash followed by newline", () => {
			const result =
				formatter.testReplaceLinebreakInString("Line1\\\\\\nLine2");
			expect(result).toBe("Line1\\\nLine2");
		});

		it("should handle multiple consecutive backslashes", () => {
			const result =
				formatter.testReplaceLinebreakInString("Line1\\\\\\\\Line2");
			expect(result).toBe("Line1\\\\Line2");
		});
	});

	describe("Test cases from PR description", () => {
		it('should handle "Line1\\\\Line2"', () => {
			const result = formatter.testReplaceLinebreakInString("Line1\\\\Line2");
			expect(result).toBe("Line1\\Line2");
		});

		it('should handle "Line1\\\\\\\\Line2"', () => {
			const result =
				formatter.testReplaceLinebreakInString("Line1\\\\\\\\Line2");
			expect(result).toBe("Line1\\\\Line2");
		});

		it('should handle "Line1\\tLine2"', () => {
			const result = formatter.testReplaceLinebreakInString("Line1\\tLine2");
			expect(result).toBe("Line1\\tLine2");
		});

		it('should handle "Line1\\nLine2"', () => {
			const result = formatter.testReplaceLinebreakInString("Line1\\nLine2");
			expect(result).toBe("Line1\nLine2");
		});

		it('should handle "Line1\\n\\nLine2"', () => {
			const result = formatter.testReplaceLinebreakInString("Line1\\n\\nLine2");
			expect(result).toBe("Line1\n\nLine2");
		});

		it('should handle "Line1\\n\\\\nLine2"', () => {
			const result =
				formatter.testReplaceLinebreakInString("Line1\\n\\\\nLine2");
			expect(result).toBe("Line1\n\\nLine2");
		});

		it('should handle "Line1\\n\\\\\\\\nLine2"', () => {
			const result = formatter.testReplaceLinebreakInString(
				"Line1\\n\\\\\\nLine2"
			);
			expect(result).toBe("Line1\n\\\nLine2");
		});
	});
});
