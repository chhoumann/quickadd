import { StubFormatter as FormatterStub } from "../../tests/helpers/formatters/stubFormatter";
import { describe, it, expect, beforeEach } from "vitest";
import { FIELD_VARIABLE_PREFIX } from "../constants";

// Issue #1655: authors quote tokens in template front matter so the raw
// template is valid YAML (Obsidian warns on bare `{{...}}`). The substituted
// value must then be escaped for the surrounding quotes, or a value containing
// the quote character corrupts the created note's front matter.
class QuotedScalarTestFormatter extends FormatterStub {

	protected async format(input: string): Promise<string> {
		let output = input;
		output = await this.replaceValueInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceFieldVarInString(output);
		return output;
	}

	protected promptForValue(): string {
		return this.anonymousValue;
	}

	public anonymousValue = "";

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	public async testFormat(input: string): Promise<string> {
		return await this.format(input);
	}

	public seed(key: string, value: unknown): void {
		this.variables.set(key, value);
	}
}

describe("issue #1655: values substituted into author-quoted front matter scalars", () => {
	let formatter: QuotedScalarTestFormatter;

	beforeEach(() => {
		formatter = new QuotedScalarTestFormatter();
	});

	it("escapes double quotes in a VALUE inside a double-quoted scalar", async () => {
		formatter.seed("fileName", 'My "Great" Note');
		const result = await formatter.testFormat(
			'---\nTitle: "{{VALUE:fileName}}"\n---\nBody',
		);
		expect(result).toBe('---\nTitle: "My \\"Great\\" Note"\n---\nBody');
	});

	it("doubles apostrophes in a VALUE inside a single-quoted scalar", async () => {
		formatter.seed("who", "O'Brien");
		const result = await formatter.testFormat(
			"---\nauthor: '{{VALUE:who}}'\n---\nBody",
		);
		expect(result).toBe("---\nauthor: 'O''Brien'\n---\nBody");
	});

	it("escapes a FIELD value inside a double-quoted scalar", async () => {
		formatter.seed(`${FIELD_VARIABLE_PREFIX}status`, 'in "review"');
		const result = await formatter.testFormat(
			'---\nstatus: "{{FIELD:status}}"\n---\nBody',
		);
		expect(result).toBe('---\nstatus: "in \\"review\\""\n---\nBody');
	});

	it("leaves unquoted substitutions untouched", async () => {
		formatter.seed("fileName", 'My "Great" Note');
		const result = await formatter.testFormat(
			"---\nTitle: {{VALUE:fileName}}\n---\nBody",
		);
		expect(result).toBe('---\nTitle: My "Great" Note\n---\nBody');
	});

	it("escapes the anonymous {{VALUE}} inside a double-quoted scalar", async () => {
		formatter.anonymousValue = 'he said "hi"';
		const result = await formatter.testFormat(
			'---\ntitle: "{{VALUE}}"\n---\nBody',
		);
		expect(result).toBe('---\ntitle: "he said \\"hi\\""\n---\nBody');
	});

	it("escapes the anonymous {{NAME}} form the same way", async () => {
		formatter.anonymousValue = 'he said "hi"';
		const result = await formatter.testFormat(
			'---\ntitle: "{{NAME}}"\n---\nBody',
		);
		expect(result).toBe('---\ntitle: "he said \\"hi\\""\n---\nBody');
	});

	it("escapes a joined multi-select FIELD fallback inside a quoted scalar", async () => {
		formatter.seed(`${FIELD_VARIABLE_PREFIX}tags|multi`, ['say "hi"', "b"]);
		const result = await formatter.testFormat(
			'---\ntags: "{{FIELD:tags|multi}}"\n---\nBody',
		);
		expect(result).toBe('---\ntags: "say \\"hi\\",b"\n---\nBody');
	});

	it.each([
		{ name: "consumes author quotes when an explicit |type:number is declared", input: "num", input2: "42", input3: '---\nrating: "{{VALUE:num|type:number}}"\n---\nBody', expected: "---\nrating: 42\n---\nBody" },
		{ name: "consumes author quotes for |type:checkbox", input: "d", input2: "true", input3: '---\ndone: "{{VALUE:d|type:checkbox}}"\n---\nBody', expected: "---\ndone: true\n---\nBody" },
		{ name: "keeps quotes for |type:text (string semantics)", input: "id", input2: "0042", input3: '---\nid: "{{VALUE:id|type:text}}"\n---\nBody', expected: '---\nid: "0042"\n---\nBody' },
		{ name: "keeps quotes and escapes for |type:multiline", input: "n", input2: "a\nb", input3: '---\nnotes: "{{VALUE:n|type:multiline}}"\n---\nBody', expected: '---\nnotes: "a\\nb"\n---\nBody' },
		{ name: "does not consume quotes in the note body", input: "num", input2: "42", input3: '---\nTitle: x\n---\nSaid "{{VALUE:num|type:number}}" today', expected: '---\nTitle: x\n---\nSaid "42" today' },
	])("$name", async ({ input, input2, input3, expected }) => {
		formatter.seed(input, input2);
		const result = await formatter.testFormat(
			input3,
		);
		expect(result).toBe(expected);
	});

	it("leaves body substitutions untouched even when the author wrote quotes", async () => {
		formatter.seed("quote", 'she said "hi"');
		const result = await formatter.testFormat(
			'---\nTitle: x\n---\nThey wrote "{{VALUE:quote}}" today',
		);
		expect(result).toBe(
			'---\nTitle: x\n---\nThey wrote "she said "hi"" today',
		);
	});
});
