import { beforeEach, describe, expect, it } from 'vitest';
import { Formatter } from './formatter';

class TemplatePropertyTypesTestFormatter extends Formatter {
	protected async format(input: string): Promise<string> {
		return await this.replaceVariableInString(input);
	}

	protected promptForValue(): string {
		return '';
	}

	protected getCurrentFileLink(): string | null {
		return null;
	}

	protected getVariableValue(variableName: string): string {
		const value = this.variables.get(variableName);
		return typeof value === 'string' ? value : '';
	}

	protected suggestForValue(): string {
		return '';
	}

	protected suggestForField(): Promise<string> {
		return Promise.resolve('');
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve('');
	}

	protected getMacroValue(): string {
		return '';
	}

	protected promptForVariable(): Promise<string> {
		return Promise.resolve('');
	}

	protected getTemplateContent(): Promise<string> {
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

	beforeEach(() => {
		formatter = new TemplatePropertyTypesTestFormatter();
	});

	it('collects comma-separated values as YAML arrays', async () => {
		(formatter as any).variables.set('tags', 'tag1, tag2, awesomeproject');
		await formatter.testFormat('---\ntags: {{VALUE:tags}}\n---');
		const vars = formatter.getAndClearTemplatePropertyVars();
		expect(vars.get('tags')).toEqual(['tag1', 'tag2', 'awesomeproject']);
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
