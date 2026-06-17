import type { App } from 'obsidian';
import { beforeEach, describe, expect, it } from 'vitest';
import { Formatter } from './formatter';

class TemplatePropertyTypesTestFormatter extends Formatter {
	public propertyTypesEnabled = true;

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
		return (this.variables.get(variableName) as string) ?? '';
	}

	protected suggestForValue(
		_suggestedValues: string[],
		_allowCustomInput?: boolean,
		_context?: { placeholder?: string; variableKey?: string },
	): string {
		return '';
	}

	protected suggestForFile(): string {
		return "";
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
		return this.propertyTypesEnabled;
	}

	public async testFormat(input: string): Promise<string> {
		return await this.format(input);
	}

	public async testFormatWithTemplatePropertyCollection(
		input: string,
	): Promise<string> {
		return await this.withTemplatePropertyCollection(() =>
			this.testFormat(input),
		);
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
		await formatter.testFormatWithTemplatePropertyCollection(
			'---\ntags: {{VALUE:tags}}\n---',
		);
		const vars = formatter.getAndClearTemplatePropertyVars();
		expect(vars.get('tags')).toEqual(['tag1', 'tag2', 'awesomeproject']);
	});

	it('does not collect comma text for scalar properties', async () => {
		(formatter as any).variables.set('description', 'Hello, world');
		await formatter.testFormatWithTemplatePropertyCollection(
			'---\ndescription: {{VALUE:description}}\n---',
		);
		const vars = formatter.getAndClearTemplatePropertyVars();
		expect(vars.has('description')).toBe(false);
	});

	it('collects bullet list values as YAML arrays', async () => {
		(formatter as any).variables.set('projects', '- project1\n- project2');
		await formatter.testFormatWithTemplatePropertyCollection(
			'---\nprojects: {{VALUE:projects}}\n---',
		);
		const vars = formatter.getAndClearTemplatePropertyVars();
		expect(vars.get('projects')).toEqual(['project1', 'project2']);
	});

	it('preserves raw structured replacements outside template property collection', async () => {
		(formatter as any).variables.set('tags', ['[[John Doe]]', '[[Jane Doe]]']);
		const output = await formatter.testFormat('---\ntags: {{VALUE:tags}}\n---');
		const vars = formatter.getAndClearTemplatePropertyVars();

		expect(output).toBe('---\ntags: [[John Doe]],[[Jane Doe]]\n---');
		expect(vars.size).toBe(0);
	});

	it('uses a YAML-safe placeholder for collected arrays before post-processing', async () => {
		(formatter as any).variables.set('tags', ['[[John Doe]]', '[[Jane Doe]]']);
		const output = await formatter.testFormatWithTemplatePropertyCollection(
			'---\ntags: {{VALUE:tags}}\n---',
		);
		const vars = formatter.getAndClearTemplatePropertyVars();

		expect(output).toBe('---\ntags: []\n---');
		expect(vars.get('tags')).toEqual(['[[John Doe]]', '[[Jane Doe]]']);
	});

	it('passes trimmed scalar values to YAML property inference', async () => {
		(formatter as any).variables.set('tags', '  tag1, tag2  ');
		await formatter.testFormatWithTemplatePropertyCollection(
			'---\ntags: {{VALUE:tags|trim}}\n---',
		);
		const vars = formatter.getAndClearTemplatePropertyVars();
		expect(vars.get('tags')).toEqual(['tag1', 'tag2']);
	});

	it('trims array elements while preserving collected YAML arrays', async () => {
		(formatter as any).variables.set('tags', [' [[John Doe]] ', ' [[Jane Doe]] ']);
		const output = await formatter.testFormatWithTemplatePropertyCollection(
			'---\ntags: {{VALUE:tags|trim}}\n---',
		);
		const vars = formatter.getAndClearTemplatePropertyVars();

		expect(output).toBe('---\ntags: []\n---');
		expect(vars.get('tags')).toEqual(['[[John Doe]]', '[[Jane Doe]]']);
	});

	it('does not apply case transforms to YAML placeholders', async () => {
		(formatter as any).variables.set('done', null);
		const output =
			await formatter.testFormatWithTemplatePropertyCollection(
				'---\ndone: {{VALUE:done|case:upper}}\n---',
			);
		const vars = formatter.getAndClearTemplatePropertyVars();

		expect(output).toBe('---\ndone: null\n---');
		expect(vars.get('done')).toBeNull();
	});

	it('ignores wiki links with commas to avoid incorrect splitting', async () => {
		(formatter as any).variables.set('source', '[[test, a]]');
		await formatter.testFormatWithTemplatePropertyCollection(
			'---\nsource: {{VALUE:source}}\n---',
		);
		const vars = formatter.getAndClearTemplatePropertyVars();
		expect(vars.has('source')).toBe(false);
	});

	// Issue #662: container (array/object) values become real properties even
	// with the beta toggle OFF; scalars and strings stay raw (byte-identical).
	describe('with the beta toggle OFF (real Formatter)', () => {
		beforeEach(() => {
			formatter.propertyTypesEnabled = false;
		});

		it('collects array values into a List property and leaves a [] placeholder', async () => {
			(formatter as any).variables.set('cast', ['[[Ewan McGregor]]', '[[Liam Neeson]]']);
			const output = await formatter.testFormatWithTemplatePropertyCollection(
				'---\ncast: {{VALUE:cast}}\n---',
			);
			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(output).toBe('---\ncast: []\n---');
			expect(vars.get('cast')).toEqual(['[[Ewan McGregor]]', '[[Liam Neeson]]']);
		});

		it('does NOT collect bare numbers (YAML-safe inline, byte-identical)', async () => {
			(formatter as any).variables.set('rating', 8.5);
			const output = await formatter.testFormatWithTemplatePropertyCollection(
				'---\nrating: {{VALUE:rating}}\n---',
			);
			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(output).toBe('---\nrating: 8.5\n---');
			expect(vars.size).toBe(0);
		});

		it('coerces non-string values before applying text-only trim options', async () => {
			(formatter as any).variables.set('rating', 8.5);
			const output = await formatter.testFormatWithTemplatePropertyCollection(
				'---\nrating: {{VALUE:rating|trim}}\n---',
			);
			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(output).toBe('---\nrating: 8.5\n---');
			expect(vars.size).toBe(0);
		});

		it('does NOT collect plain strings (stays raw)', async () => {
			(formatter as any).variables.set('title', 'Phantom Menace');
			const output = await formatter.testFormatWithTemplatePropertyCollection(
				'---\ntitle: {{VALUE:title}}\n---',
			);
			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(output).toBe('---\ntitle: Phantom Menace\n---');
			expect(vars.size).toBe(0);
		});

		it('coerces non-string values when substituting raw so the scanner stays aligned (replacement.length fix)', async () => {
			// Two array tokens on the same non-frontmatter line: both must substitute.
			(formatter as any).variables.set('a', ['p', 'q']);
			(formatter as any).variables.set('b', ['r', 's']);
			const output = await formatter.testFormat('x {{VALUE:a}} y {{VALUE:b}} z');
			expect(output).toBe('x p,q y r,s z');
		});
	});
});
