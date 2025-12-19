import type { App } from 'obsidian';
import { beforeEach, describe, expect, it } from 'vitest';
import { Formatter } from './formatter';

class TemplatePropertyTypesTestFormatter extends Formatter {
	constructor(app?: App) {
		super(app);
	}

	protected async format(input: string): Promise<string> {
		return await this.replaceVariableInString(input);
	}

	protected promptForValue(): string {
		return '';
	}

	protected getCurrentFileLink(): string | null {
		return null;
	}

	protected getCurrentFileName(): string | null {
		return null;
	}

	protected getVariableValue(variableName: string): string {
		const value = this.variables.get(variableName);
		return typeof value === 'string' ? value : '';
	}

	protected suggestForValue(
		_suggestedValues: string[],
		_allowCustomInput?: boolean,
		_context?: { placeholder?: string; variableKey?: string },
	): string {
		return '';
	}

	protected suggestForField(_variableName: string): Promise<string> {
		return Promise.resolve('');
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve('');
	}

	protected getMacroValue(
		_macroName: string,
		_context?: { label?: string },
	): string {
		return '';
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
		return Promise.resolve('');
	}

	protected getTemplateContent(_templatePath: string): Promise<string> {
		return Promise.resolve('');
	}

	protected getSelectedText(): Promise<string> {
		return Promise.resolve('');
	}

	protected getClipboardContent(): Promise<string> {
		return Promise.resolve('');
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return true;
	}

	public async testFormat(input: string): Promise<string> {
		return await this.format(input);
	}
}

describe('Formatter template property type inference', () => {
	let formatter: TemplatePropertyTypesTestFormatter;
	let app: App;

	const createMockApp = (typeMap: Record<string, string>): App => {
		return {
			metadataCache: {
				app: {
					metadataTypeManager: {
						getTypeInfo: (key: string) => ({ expected: { type: typeMap[key] } }),
					},
				},
			},
		} as unknown as App;
	};

	beforeEach(() => {
		app = createMockApp({ tags: 'tags', projects: 'multitext', description: 'text' });
		formatter = new TemplatePropertyTypesTestFormatter(app);
	});

	it('collects comma-separated values as YAML arrays', async () => {
		(formatter as any).variables.set('tags', 'tag1, tag2, awesomeproject');
		await formatter.testFormat('---\ntags: {{VALUE:tags}}\n---');
		const vars = formatter.getAndClearTemplatePropertyVars();
		expect(vars.get('tags')).toEqual(['tag1', 'tag2', 'awesomeproject']);
	});

	it('does not collect comma text for scalar properties', async () => {
		(formatter as any).variables.set('description', 'Hello, world');
		await formatter.testFormat('---\ndescription: {{VALUE:description}}\n---');
		const vars = formatter.getAndClearTemplatePropertyVars();
		expect(vars.has('description')).toBe(false);
	});

	it('collects bullet list values as YAML arrays', async () => {
		(formatter as any).variables.set('projects', '- project1\n- project2');
		await formatter.testFormat('---\nprojects: {{VALUE:projects}}\n---');
		const vars = formatter.getAndClearTemplatePropertyVars();
		expect(vars.get('projects')).toEqual(['project1', 'project2']);
	});

	it('ignores wiki links with commas to avoid incorrect splitting', async () => {
		(formatter as any).variables.set('source', '[[test, a]]');
		await formatter.testFormat('---\nsource: {{VALUE:source}}\n---');
		const vars = formatter.getAndClearTemplatePropertyVars();
		expect(vars.has('source')).toBe(false);
	});
});
