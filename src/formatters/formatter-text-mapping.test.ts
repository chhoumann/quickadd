import { beforeEach, describe, expect, it } from "vitest";
import type { PromptContext } from "./formatter";
import { Formatter } from "./formatter";

class TextMappingFormatter extends Formatter {
	private nextSuggestionResult = "";
	private hasExplicitSuggestionResult = false;
	private selectedDisplayValue?: string;
	public lastSuggestCall:
		| {
				suggestedValues: string[];
				allowCustomInput: boolean;
				displayValues?: string[];
		  }
		| undefined;

	constructor() {
		super();
	}

	public setSelectedDisplayValue(value: string): void {
		this.selectedDisplayValue = value;
	}

	public setNextSuggestionResult(value: string): void {
		this.nextSuggestionResult = value;
		this.hasExplicitSuggestionResult = true;
	}

	public setVariable(name: string, value: unknown): void {
		this.variables.set(name, value);
	}

	public async testFormat(input: string): Promise<string> {
		return await this.format(input);
	}

	public async testValueFormat(input: string): Promise<string> {
		return await this.replaceValueInString(input);
	}

	protected async format(input: string): Promise<string> {
		let output = input;
		output = await this.replaceVariableInString(output);
		return output;
	}

	protected promptForValue(): Promise<string> {
		return Promise.resolve("");
	}

	protected getCurrentFileLink(): string | null {
		return null;
	}

	protected getCurrentFileName(): string | null {
		return null;
	}

	protected getVariableValue(variableName: string): string {
		const value = this.variables.get(variableName);
		return typeof value === "string" ? value : "";
	}

	protected suggestForValue(
		suggestedValues: string[],
		allowCustomInput = false,
		context?: {
			placeholder?: string;
			variableKey?: string;
			displayValues?: string[];
		},
	): string {
		this.lastSuggestCall = {
			suggestedValues,
			allowCustomInput,
			displayValues: context?.displayValues,
		};

		if (this.hasExplicitSuggestionResult) {
			return this.nextSuggestionResult;
		}

		if (this.selectedDisplayValue && context?.displayValues) {
			const selectedIndex = context.displayValues.indexOf(
				this.selectedDisplayValue,
			);
			if (selectedIndex >= 0) {
				return suggestedValues[selectedIndex] ?? "";
			}
		}

		return suggestedValues[0] ?? "";
	}

	protected suggestForFile(): string {
		return "";
	}

	protected suggestForField(_variableName: string): Promise<string> {
		return Promise.resolve("");
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("");
	}

	protected getMacroValue(_macroName: string): Promise<string> {
		return Promise.resolve("");
	}

	protected promptForVariable(
		_variableName: string,
		_context?: PromptContext,
	): Promise<string> {
		return Promise.resolve("");
	}

	protected getTemplateContent(_templatePath: string): Promise<string> {
		return Promise.resolve("");
	}

	protected getSelectedText(): Promise<string> {
		return Promise.resolve("");
	}

	protected getClipboardContent(): Promise<string> {
		return Promise.resolve("");
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false;
	}
}

describe("Formatter VALUE text mapping", () => {
	let formatter: TextMappingFormatter;

	beforeEach(() => {
		formatter = new TextMappingFormatter();
	});

	it("passes display mappings to suggesters and inserts mapped item values", async () => {
		formatter.setSelectedDisplayValue("High");
		const result = await formatter.testFormat(
			"{{VALUE:🔼,⏫|text:Normal,High}}",
		);

		expect(result).toBe("⏫");
		expect(formatter.lastSuggestCall?.suggestedValues).toEqual(["🔼", "⏫"]);
		expect(formatter.lastSuggestCall?.displayValues).toEqual([
			"Normal",
			"High",
		]);
	});

	it("applies default values against inserted item values", async () => {
		formatter.setNextSuggestionResult("");
		const result = await formatter.testFormat(
			"{{VALUE:🔼,⏫|text:Normal,High|default:⏫}}",
		);

		expect(result).toBe("⏫");
	});

	// #239: a comma inside a quoted item/label round-trips end-to-end — selecting
	// the comma-bearing display label inserts the comma-bearing item value.
	it("maps a quoted-comma display label to its quoted-comma item value", async () => {
		formatter.setSelectedDisplayValue("High, urgent");
		const result = await formatter.testFormat(
			'{{VALUE:high,"a, b"|text:"High, urgent","A or B"}}',
		);

		expect(result).toBe("high");
		expect(formatter.lastSuggestCall?.suggestedValues).toEqual([
			"high",
			"a, b",
		]);
		expect(formatter.lastSuggestCall?.displayValues).toEqual([
			"High, urgent",
			"A or B",
		]);

		// Fresh formatter: the first instance has already cached its selection.
		const second = new TextMappingFormatter();
		second.setSelectedDisplayValue("A or B");
		expect(
			await second.testFormat(
				'{{VALUE:high,"a, b"|text:"High, urgent","A or B"}}',
			),
		).toBe("a, b");
	});

	it("keeps custom typed values when custom input is enabled", async () => {
		formatter.setNextSuggestionResult("urgent!");
		const result = await formatter.testFormat(
			"{{VALUE:🔼,⏫|text:Normal,High|custom}}",
		);

		expect(result).toBe("urgent!");
		expect(formatter.lastSuggestCall?.allowCustomInput).toBe(true);
	});

	it("does not remap typed custom values that equal display labels", async () => {
		formatter.setNextSuggestionResult("High");
		const result = await formatter.testFormat(
			"{{VALUE:🔼,⏫|text:Normal,High|custom}}",
		);

		expect(result).toBe("High");
	});

	it("throws for duplicate display labels in text mappings", async () => {
		await expect(
			formatter.testFormat("{{VALUE:a,b|text:Same,Same}}"),
		).rejects.toThrow(/duplicate text entries/i);
	});

	it("formats injected object VALUE variables without default object stringification", async () => {
		formatter.setVariable("value", { title: "Project", count: 2 });

		const result = await formatter.testValueFormat("{{VALUE}}");

		expect(result).toBe('{"title":"Project","count":2}');
	});
});
