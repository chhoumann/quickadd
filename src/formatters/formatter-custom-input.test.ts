import { describe, it, expect, beforeEach } from 'vitest';

// Mock the abstract methods for testing
class TestFormatter {
	protected variables: Map<string, unknown> = new Map();
	private promptResponses: Map<string, string> = new Map();
	private suggesterResponses: Map<string, string> = new Map();
	private allowCustomInputCalls: boolean[] = [];

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	protected replacer(str: string, reg: RegExp, replaceValue: string) {
		return str.replace(reg, function () {
			return replaceValue;
		});
	}

	protected async promptForVariable(variableName: string): Promise<string> {
		return this.promptResponses.get(variableName) || "";
	}

	protected async suggestForValue(suggestedValues: string[], allowCustomInput = false): Promise<string> {
		this.allowCustomInputCalls.push(allowCustomInput);
		const key = suggestedValues.join(",");
		return this.suggesterResponses.get(key) || "";
	}

	protected hasConcreteVariable(variableName: string): boolean {
		const value = this.variables.get(variableName);
		return value !== undefined && value !== null && value !== "";
	}

	// Expose the method we're testing
	public async testReplaceVariableInString(input: string): Promise<string> {
		const VARIABLE_REGEX = /{{VALUE:([^\n\r}]*)}}/i;
		let output: string = input;

		while (VARIABLE_REGEX.test(output)) {
			const match = VARIABLE_REGEX.exec(output);
			if (!match) throw new Error("unable to parse variable");

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
				const suggestedValues = variableName.split(",");
				let variableValue = "";
				let actualDefaultValue = defaultValue;

				if (suggestedValues.length === 1) {
				 variableValue = await this.promptForVariable(variableName);
				} else {
				// Check if defaultValue contains the |custom modifier
				const allowCustomInput = defaultValue.toLowerCase() === "custom";
				// If custom modifier is present, don't use it as default value
				actualDefaultValue = allowCustomInput ? "" : defaultValue;
				
					variableValue = await this.suggestForValue(suggestedValues, allowCustomInput);
				}

				// Use default value if no input provided (applies to both prompt and suggester)
				if (!variableValue && actualDefaultValue) {
				 variableValue = actualDefaultValue;
				}

				 this.variables.set(variableName, variableValue);
			}

				output = this.replacer(
					output,
					VARIABLE_REGEX,
					this.getVariableValue(variableName)
				);
			} else {
				break;
			}
		}

		return output;
	}

	// Test helpers
	public setPromptResponse(variableName: string, response: string) {
		this.promptResponses.set(variableName, response);
	}

	public setSuggesterResponse(values: string[], response: string) {
		this.suggesterResponses.set(values.join(","), response);
	}

	public clearVariables() {
		this.variables.clear();
		this.promptResponses.clear();
		this.suggesterResponses.clear();
		this.allowCustomInputCalls = [];
	}

	public getLastAllowCustomInputCall(): boolean | undefined {
		return this.allowCustomInputCalls[this.allowCustomInputCalls.length - 1];
	}
}

describe('Formatter - Custom Input Modifier for {{VALUE:}}', () => {
	let formatter: TestFormatter;

	beforeEach(() => {
		formatter = new TestFormatter();
	});

	it('should use GenericSuggester (allowCustomInput=false) by default', async () => {
		formatter.setSuggesterResponse(["Red", "Green", "Blue"], "Red");
		const input = "{{VALUE:Red,Green,Blue}}";
		const result = await formatter.testReplaceVariableInString(input);

		expect(result).toBe("Red");
		expect(formatter.getLastAllowCustomInputCall()).toBe(false);
	});

	it('should use InputSuggester (allowCustomInput=true) with |custom modifier', async () => {
		formatter.setSuggesterResponse(["Red", "Green", "Blue"], "Purple");
		const input = "{{VALUE:Red,Green,Blue|custom}}";
		const result = await formatter.testReplaceVariableInString(input);

		expect(result).toBe("Purple");
		expect(formatter.getLastAllowCustomInputCall()).toBe(true);
	});

	it('should handle |custom modifier case-insensitively', async () => {
		formatter.setSuggesterResponse(["One", "Two"], "Three");
		const input = "{{VALUE:One,Two|CUSTOM}}";
		const result = await formatter.testReplaceVariableInString(input);

		expect(result).toBe("Three");
		expect(formatter.getLastAllowCustomInputCall()).toBe(true);
	});

	it('should handle |Custom modifier with mixed case', async () => {
		formatter.setSuggesterResponse(["A", "B"], "C");
		const input = "{{VALUE:A,B|Custom}}";
		const result = await formatter.testReplaceVariableInString(input);

		expect(result).toBe("C");
		expect(formatter.getLastAllowCustomInputCall()).toBe(true);
	});

	it('should use default value when no custom modifier and no input', async () => {
		formatter.setSuggesterResponse(["Red", "Green", "Blue"], "");
		const input = "{{VALUE:Red,Green,Blue|Yellow}}";
		const result = await formatter.testReplaceVariableInString(input);

		expect(result).toBe("Yellow");
		expect(formatter.getLastAllowCustomInputCall()).toBe(false);
	});

	it('should not use "custom" as default value', async () => {
		formatter.setSuggesterResponse(["Red", "Green"], "");
		const input = "{{VALUE:Red,Green|custom}}";
		const result = await formatter.testReplaceVariableInString(input);

		// Should be empty since "custom" is treated as modifier, not default
		expect(result).toBe("");
		expect(formatter.getLastAllowCustomInputCall()).toBe(true);
	});

	it('should preserve spacing around |custom modifier', async () => {
		formatter.setSuggesterResponse(["A", "B"], "CustomValue");
		const input = "{{VALUE:A,B| custom }}";
		const result = await formatter.testReplaceVariableInString(input);

		// "custom" with spaces should still be recognized after trim
		expect(result).toBe("CustomValue");
		expect(formatter.getLastAllowCustomInputCall()).toBe(true);
	});

	it('should handle multiple VALUE tokens with different modifiers', async () => {
		formatter.setSuggesterResponse(["Red", "Green"], "Purple");
		formatter.setSuggesterResponse(["Cat", "Dog"], "Bird");

		const input = "Color: {{VALUE:Red,Green|custom}} Animal: {{VALUE:Cat,Dog}}";
		const result = await formatter.testReplaceVariableInString(input);

		expect(result).toBe("Color: Purple Animal: Bird");
	});

	it('should allow custom input for each occurrence', async () => {
		formatter.setSuggesterResponse(["A", "B"], "CustomA");
		
		const input1 = "{{VALUE:A,B|custom}}";
		const result1 = await formatter.testReplaceVariableInString(input1);
		expect(result1).toBe("CustomA");
		
		formatter.clearVariables();
		formatter.setSuggesterResponse(["A", "B"], "CustomB");
		
		const input2 = "{{VALUE:A,B|custom}}";
		const result2 = await formatter.testReplaceVariableInString(input2);
		expect(result2).toBe("CustomB");
	});

	it('should work with single option and custom modifier', async () => {
		formatter.setPromptResponse("OnlyOption", "");
		const input = "{{VALUE:OnlyOption|custom}}";
		const result = await formatter.testReplaceVariableInString(input);

		// Note: Single option uses promptForVariable, not suggestForValue
		// The |custom modifier only applies to suggesters, so for single-value prompts
		// it's treated as a default value
		expect(result).toBe("custom");
	});

	it('should handle trimmed values correctly with custom modifier', async () => {
		// Note: The variable name "Red, Green, Blue" gets split but spaces aren't trimmed in the split
		// So the key is ["Red", " Green", " Blue"]
		formatter.setSuggesterResponse(["Red", " Green", " Blue"], "Custom Color");
		const input = "{{VALUE:Red, Green, Blue|custom}}";
		const result = await formatter.testReplaceVariableInString(input);

		expect(result).toBe("Custom Color");
		expect(formatter.getLastAllowCustomInputCall()).toBe(true);
	});

	it('should use default value for single-value prompt when no input provided', async () => {
		// Regression test: single-value prompts should get default fallback
		formatter.setPromptResponse("name", "");
		const input = "{{VALUE:name|DefaultName}}";
		const result = await formatter.testReplaceVariableInString(input);

		expect(result).toBe("DefaultName");
	});
});
