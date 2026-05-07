import { beforeEach, describe, expect, it, vi } from "vitest";
import { GLOBAL_VAR_REGEX } from "../constants";
import type { PromptContext } from "./formatter";
import { Formatter } from "./formatter";
import { RequirementCollector } from "src/preflight/RequirementCollector";
import { buildValueVariableKey } from "src/utils/valueSyntax";

const CURRENT_AND_2120_EXAMPLES = [
	"Daily/{{DATE}}.md",
	"Review on {{DATE+7}}",
	"{{DATE:YYYY-MM-DD_HH-mm}}",
	"{{DATE:YYYY-MM-DD+3}}",
	"Due: {{VDATE:due,YYYY-MM-DD}}\nWeek: {{VDATE:due,gggg-[W]WW}}",
	"{{VDATE:due,YYYY-MM-DD|next monday}}",
	"- [ ] {{VALUE|label:Task}}",
	"---\ntitle: {{VALUE:title}}\n---\n# {{VALUE:title}}",
	"{{VALUE:project|label:Client or project name}}",
	"priority: {{VALUE:🔽,🔼,⏫|text:Low,Normal,High}}",
	"status: {{VALUE:status|Draft}}",
	"{{VALUE:title|label:Note title|default:Untitled}}",
	"## Summary\n{{VALUE:summary|type:multiline|label:Summary}}",
	"{{DATE:YYYY-MM-DD}}-{{VALUE:title|case:slug}}.md",
	"{{VALUE:Red,Green,Blue|custom}}",
	"Source: {{LINKCURRENT}}",
	"Notes from {{FILENAMECURRENT}}",
	"{{MACRO:Generate summary}}",
	"{{MACRO:Choose project|label:Project}}",
	"{{TEMPLATE:Templates/Meeting.md}}",
	"{{GLOBAL_VAR:Meeting Header}}",
	"Equation: ${{MVALUE}}$",
	"project: {{FIELD:project}}",
	"status: {{FIELD:status|default:Draft|default-always:true}}",
	"id: {{FIELD:Id|inline:true|inline-code-blocks:ad-note}}",
	"> {{selected}}",
	"Copied: {{CLIPBOARD}}",
	"^{{RANDOM:6}}",
	"# {{TITLE}}",
];

const VERSION_294_EXAMPLES = [
	"Daily/{{DATE}}.md",
	"Review on {{DATE+7}}",
	"{{DATE:YYYY-MM-DD_HH-mm}}",
	"{{DATE:YYYY-MM-DD+3}}",
	"Due: {{VDATE:due,YYYY-MM-DD}}\nWeek: {{VDATE:due,gggg-[W]WW}}",
	"{{VDATE:due,YYYY-MM-DD|next monday}}",
	"- [ ] {{VALUE}}",
	"---\ntitle: {{VALUE:title}}\n---\n# {{VALUE:title}}",
	"status: {{VALUE:status|Draft}}",
	"{{VALUE:Red,Green,Blue|custom}}",
	"Source: {{LINKCURRENT}}",
	"Notes from {{FILENAMECURRENT}}",
	"{{MACRO:Generate summary}}",
	"{{TEMPLATE:Templates/Meeting.md}}",
	"{{GLOBAL_VAR:Meeting Header}}",
	"Equation: ${{MVALUE}}$",
	"project: {{FIELD:project}}",
	"status: {{FIELD:status|default:Draft|default-always:true}}",
	"> {{selected}}",
	"Copied: {{CLIPBOARD}}",
	"^{{RANDOM:6}}",
	"# {{TITLE}}",
];

function installMomentStub(): void {
	const moment = vi.fn((input?: string) => {
		let offset = 0;

		return {
			add(duration?: { amount: number }) {
				offset = duration?.amount ?? 0;
				return this;
			},
			format(format = "YYYY-MM-DD") {
				if (input?.startsWith("2026-05-11")) {
					if (format === "gggg-[W]WW") return "2026-W20";
					if (format === "YYYY-MM-DD") return "2026-05-11";
					return `2026-05-11:${format}`;
				}

				if (format === "YYYY-MM-DD_HH-mm") return "2026-05-07_09-30";
				if (format === "YYYY-MM-DD") {
					if (offset === 7) return "2026-05-14";
					if (offset === 3) return "2026-05-10";
					return "2026-05-07";
				}

				return "2026-05-07";
			},
			isValid: () => true,
			toISOString: () => input ?? "2026-05-11T00:00:00.000Z",
		};
	}) as any;
	moment.duration = vi.fn((amount: number, unit: string) => ({
		amount,
		unit,
	}));

	(globalThis as any).window ??= globalThis;
	(globalThis as any).window.moment = moment;
}

class DocsExampleFormatter extends Formatter {
	public readonly suggestCalls: Array<{
		suggestedValues: string[];
		allowCustomInput?: boolean;
		displayValues?: string[];
	}> = [];

	constructor() {
		super();
		this.dateParser = {
			parseDate: () => ({
				moment: {
					format: (format: string) => `2026-05-11:${format}`,
					toISOString: () => "2026-05-11T00:00:00.000Z",
					isValid: () => true,
				},
			}),
		};
		this.variables.set("title", "Project Update");
	}

	public async render(input: string): Promise<string> {
		return await this.format(input);
	}

	protected async format(input: string): Promise<string> {
		let output = input;
		output = await this.replaceMacrosInString(output);
		output = await this.replaceTemplateInString(output);
		output = await this.replaceGlobalVarInString(output);
		output = this.replaceDateInString(output);
		output = await this.replaceValueInString(output);
		output = await this.replaceSelectedInString(output);
		output = await this.replaceClipboardInString(output);
		output = await this.replaceDateVariableInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceFieldVarInString(output);
		output = await this.replaceMathValueInString(output);
		output = await this.replaceLinkToCurrentFileInString(output);
		output = await this.replaceCurrentFileNameInString(output);
		output = this.replaceRandomInString(output);
		output = this.replaceTitleInString(output);
		return output;
	}

	private async replaceGlobalVarInString(input: string): Promise<string> {
		return input.replace(GLOBAL_VAR_REGEX, (_match, rawName) => {
			const snippets: Record<string, string> = {
				"Meeting Header": "## Meeting\n{{DATE:YYYY-MM-DD}}",
			};
			return snippets[String(rawName).trim()] ?? "";
		});
	}

	protected promptForValue(): string {
		return this.valuePromptContext?.defaultValue ?? "Task value";
	}

	protected getCurrentFileLink(): string {
		return "[[Current Note]]";
	}

	protected getCurrentFileName(): string {
		return "Current Note";
	}

	protected getVariableValue(variableName: string): string {
		const value = this.variables.get(variableName);
		return value === undefined || value === null ? "" : String(value);
	}

	protected suggestForValue(
		suggestedValues: string[],
		allowCustomInput?: boolean,
		context?: { displayValues?: string[] },
	): string {
		this.suggestCalls.push({
			suggestedValues,
			allowCustomInput,
			displayValues: context?.displayValues,
		});
		return suggestedValues[0] ?? "";
	}

	protected async suggestForField(variableName: string): Promise<string> {
		return `[field:${variableName}]`;
	}

	protected async promptForMathValue(): Promise<string> {
		return "x^2+y^2";
	}

	protected async getMacroValue(
		macroName: string,
		context?: { label?: string },
	): Promise<string> {
		return context?.label
			? `[macro:${macroName}|label:${context.label}]`
			: `[macro:${macroName}]`;
	}

	protected async promptForVariable(
		variableName: string,
		context?: PromptContext,
	): Promise<string> {
		if (context?.type === "VDATE") return "2026-05-11";
		if (context?.defaultValue) return context.defaultValue;

		const values: Record<string, string> = {
			project: "Acme",
			status: "Draft",
			summary: "Line one\nLine two",
			title: "Project Update",
		};
		return values[variableName] ?? `value:${variableName}`;
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		return `[template:${templatePath}]`;
	}

	protected async getSelectedText(): Promise<string> {
		return "selected text";
	}

	protected async getClipboardContent(): Promise<string> {
		return "clipboard text";
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false;
	}
}

const makeApp = () =>
	({
		workspace: { getActiveFile: () => null },
		vault: { getAbstractFileByPath: () => null, cachedRead: async () => "" },
	}) as any;

const makePlugin = () =>
	({
		settings: {
			inputPrompt: "single-line",
			globalVariables: {
				"Meeting Header": "## Meeting\n{{DATE:YYYY-MM-DD}}",
			},
		},
	}) as any;

describe("Format Syntax documentation examples", () => {
	beforeEach(() => {
		installMomentStub();
	});

	it("renders the current and 2.12.0 examples without leaving malformed tokens", async () => {
		for (const example of CURRENT_AND_2120_EXAMPLES) {
			const formatter = new DocsExampleFormatter();
			const rendered = await formatter.render(example);

			expect(rendered, example).not.toMatch(/\{\{[^}]+}}/);
		}
	});

	it("collects requirements from the current and 2.12.0 examples", async () => {
		for (const example of CURRENT_AND_2120_EXAMPLES) {
			const collector = new RequirementCollector(makeApp(), makePlugin());

			await expect(collector.scanString(example), example).resolves.toBeUndefined();
		}

		const collector = new RequirementCollector(makeApp(), makePlugin());
		await collector.scanString(CURRENT_AND_2120_EXAMPLES.join("\n"));

		expect(collector.requirements.get("due")).toMatchObject({
			type: "date",
			dateFormat: "YYYY-MM-DD",
		});
		expect(collector.requirements.get("project")).toMatchObject({
			description: "Client or project name",
			type: "text",
		});
		expect(collector.requirements.get("summary")).toMatchObject({
			description: "Summary",
			type: "textarea",
		});
		expect(collector.requirements.get("status")).toMatchObject({
			defaultValue: "Draft",
			type: "text",
		});
		expect(
			collector.requirements.get(
				buildValueVariableKey("🔽,🔼,⏫", undefined, true),
			),
		).toMatchObject({
			type: "dropdown",
			options: ["🔽", "🔼", "⏫"],
			displayOptions: ["Low", "Normal", "High"],
		});
		expect(
			collector.requirements.get("status|default:Draft|default-always:true"),
		).toMatchObject({
			type: "field-suggest",
		});
		expect(
			collector.requirements.get(
				"Id|inline:true|inline-code-blocks:ad-note",
			),
		).toMatchObject({
			type: "field-suggest",
		});
	});

	it("keeps 2.9.4 examples on syntax supported by that snapshot", async () => {
		for (const example of VERSION_294_EXAMPLES) {
			const formatter = new DocsExampleFormatter();
			const collector = new RequirementCollector(makeApp(), makePlugin());

			await expect(formatter.render(example), example).resolves.not.toMatch(
				/\{\{[^}]+}}/,
			);
			await expect(collector.scanString(example), example).resolves.toBeUndefined();
		}
	});
});
