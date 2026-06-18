import { beforeEach, describe, expect, it } from "vitest";
import { Formatter } from "./formatter";

class FieldTitleFormatter extends Formatter {
	public fieldCalls: string[] = [];
	private fieldResponses: Map<string, string | string[]> = new Map();

	constructor() {
		super();
	}

	public setMockFieldResponse(specifier: string, value: string | string[]): void {
		this.fieldResponses.set(specifier, value);
	}

	protected async format(input: string): Promise<string> {
		let output = input;
		output = await this.replaceFieldVarInString(output);
		output = this.replaceTitleInString(output);
		return output;
	}

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	public async runFormat(input: string): Promise<string> {
		return await this.format(input);
	}

	public async runFormatWithPropertyCollection(input: string): Promise<string> {
		return await this.withTemplatePropertyCollection(() => this.format(input));
	}

	protected suggestForFile(): string {
		return "";
	}

	protected async suggestForField(specifier: string): Promise<string | string[]> {
		this.fieldCalls.push(specifier);
		const value = this.fieldResponses.get(specifier);

		if (value === undefined) {
			throw new Error(`No mock field response configured for "${specifier}".`);
		}

		return value;
	}

	protected promptForValue(): string {
		return "";
	}

	protected getCurrentFileLink(): string | null {
		return null;
	}

	protected getCurrentFileName(): string | null {
		return null;
	}

	protected suggestForValue(
		_suggestedValues: string[],
		_allowCustomInput?: boolean,
		_context?: { placeholder?: string; variableKey?: string },
	): string {
		return "";
	}

	protected async promptForVariable(
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
		return "";
	}

	protected async promptForMathValue(): Promise<string> {
		return "";
	}

	protected getMacroValue(
		_macroName: string,
		_context?: { label?: string },
	): string {
		return "";
	}

	protected async getTemplateContent(_templatePath: string): Promise<string> {
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

class FieldTitlePreviewFormatter extends FieldTitleFormatter {
	protected getVariableValue(variableName: string): string {
		return `${variableName}_preview`;
	}
}

describe("Formatter FIELD and TITLE namespace handling", () => {
	let formatter: FieldTitleFormatter;

	beforeEach(() => {
		formatter = new FieldTitleFormatter();
		formatter.setMockFieldResponse("title", "YAML Note Title");
	});

	it("resolves FIELD:title even when title variable is pre-populated", async () => {
		formatter.setTitle("My Note");

		const result = await formatter.runFormat("Field={{FIELD:title}} Title={{TITLE}}");

		expect(result).toBe("Field=YAML Note Title Title=My Note");
		expect(formatter.fieldCalls).toEqual(["title"]);
		expect((formatter as any).variables.get("title")).toBe("My Note");
		expect((formatter as any).variables.get("FIELD:title")).toBe("YAML Note Title");
	});

	it("caches FIELD:title values independently of the title variable", async () => {
		formatter.setTitle("My Note");

		const result = await formatter.runFormat("{{FIELD:title}} & {{FIELD:title}}");

		expect(result).toBe("YAML Note Title & YAML Note Title");
		expect(formatter.fieldCalls).toEqual(["title"]);
		expect((formatter as any).variables.get("title")).toBe("My Note");
	});

	it("still sets filename title when FIELD variables were resolved earlier", async () => {
		const firstPass = await formatter.runFormat("Field={{FIELD:title}}");
		expect(firstPass).toBe("Field=YAML Note Title");

		formatter.setTitle("Second Note");
		const secondPass = await formatter.runFormat("{{TITLE}}");

		expect(secondPass).toBe("Second Note");
		expect((formatter as any).variables.get("FIELD:title")).toBe("YAML Note Title");
		expect((formatter as any).variables.get("title")).toBe("Second Note");
	});

	it("preserves display formatter previews when FIELD namespace is used", async () => {
		const previewFormatter = new FieldTitlePreviewFormatter();
		previewFormatter.setMockFieldResponse("title", "Preview Title");

		const result = await previewFormatter.runFormat("{{FIELD:title}}");

		expect(result).toBe("Preview Title");
	});

	it("does not loop when a selected FIELD value is another FIELD token", async () => {
		formatter.setMockFieldResponse("type", "{{FIELD:type}}");

		const result = await formatter.runFormat("{{FIELD:type}}");

		expect(result).toBe("{{FIELD:type}}");
		expect(formatter.fieldCalls).toEqual(["type"]);
	});

	it("collects FIELD multi arrays as YAML list properties", async () => {
		formatter.setMockFieldResponse("topic|multi", ["Alpha", "Beta"]);

		const output = await formatter.runFormatWithPropertyCollection(
			"---\ntopics: {{FIELD:topic|multi}}\n---\n",
		);
		const vars = formatter.getAndClearTemplatePropertyVars();

		expect(output).toBe("---\ntopics: []\n---\n");
		expect(vars.get("topics")).toEqual(["Alpha", "Beta"]);
	});

	it("joins FIELD multi arrays outside frontmatter property positions", async () => {
		formatter.setMockFieldResponse("topic|multi", ["Alpha", "Beta"]);

		await expect(
			formatter.runFormatWithPropertyCollection(
				"Body topics: {{FIELD:topic|multi}}",
			),
		).resolves.toBe("Body topics: Alpha,Beta");
		expect(formatter.getAndClearTemplatePropertyVars().size).toBe(0);
	});

	it("collects FIELD multi arrays from YAML list item token positions", async () => {
		formatter.setMockFieldResponse("topic|multi", ["Alpha", "Beta"]);

		const output = await formatter.runFormatWithPropertyCollection(
			"---\ntopics:\n  - \"{{FIELD:topic|multi}}\"\n---\n",
		);
		const vars = formatter.getAndClearTemplatePropertyVars();

		expect(output).toBe("---\ntopics:\n  - \"[]\"\n---\n");
		expect(vars.get("topics")).toEqual(["Alpha", "Beta"]);
	});
});
