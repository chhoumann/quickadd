import { beforeEach, describe, expect, it } from "vitest";
import { Formatter } from "./formatter";

class CaseTestFormatter extends Formatter {
	private valueResponse = "";

	constructor() {
		super();
	}

	public setValueResponse(value: string): void {
		this.valueResponse = value;
	}

	public setVariable(key: string, value: unknown): void {
		this.variables.set(key, value);
	}

	protected async format(input: string): Promise<string> {
		let output = input;
		output = await this.replaceValueInString(output);
		output = await this.replaceVariableInString(output);
		return output;
	}

	protected promptForValue(): string {
		return this.valueResponse;
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
		_suggestedValues: string[],
		_allowCustomInput?: boolean,
		_context?: { placeholder?: string; variableKey?: string },
	): string {
		return "";
	}

	protected suggestForField(_variableName: string): Promise<string> {
		return Promise.resolve("");
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("");
	}

	protected getMacroValue(
		_macroName: string,
		_context?: { label?: string },
	): string {
		return "";
	}

	protected promptForVariable(
		_variableName: string,
		_context?: {
			type?: string;
			dateFormat?: string;
			defaultValue?: string;
			label?: string;
			description?: string;
			placeholder?: string;
			variableKey?: string;
		},
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

	public async testFormat(input: string): Promise<string> {
		return await this.format(input);
	}
}

describe("Formatter case: pipe option", () => {
	let formatter: CaseTestFormatter;

	beforeEach(() => {
		formatter = new CaseTestFormatter();
	});

	it("does not mutate stored named variables; each token applies its own case", async () => {
		formatter.setVariable("title", "My New Blog");
		const result = await formatter.testFormat(
			"title={{VALUE:title}} slug={{VALUE:title|case:kebab}}",
		);
		expect(result).toBe("title=My New Blog slug=my-new-blog");
	});

	it("applies case per token for anonymous VALUE/NAME", async () => {
		formatter.setValueResponse("My New Blog");
		const result = await formatter.testFormat(
			"a={{VALUE}} b={{VALUE|case:kebab}} c={{NAME|case:upper}}",
		);
		expect(result).toBe("a=My New Blog b=my-new-blog c=MY NEW BLOG");
	});

	it("supports snake/camel/pascal/title/lower transforms", async () => {
		formatter.setValueResponse("my new blog");
		const result = await formatter.testFormat(
			"snake={{VALUE|case:snake}} camel={{VALUE|case:camel}} pascal={{VALUE|case:pascal}} title={{VALUE|case:title}} lower={{VALUE|case:lower}}",
		);
		expect(result).toBe(
			"snake=my_new_blog camel=myNewBlog pascal=MyNewBlog title=My New Blog lower=my new blog",
		);
	});

	it("ignores unknown case styles (pass-through)", async () => {
		formatter.setVariable("title", "My New Blog");
		const result = await formatter.testFormat(
			"slug={{VALUE:title|case:does-not-exist}}",
		);
		expect(result).toBe("slug=My New Blog");
	});
});
