import type { App, TFile } from "obsidian";
import { log } from "../logger/logManager";
import { TemplatePropertyCollector } from "../utils/TemplatePropertyCollector";
import { coerceYamlValue } from "../utils/yamlValues";

const VALIDATION_LIMITS = {
	MAX_NESTING_DEPTH: 10,
} as const;

export interface ValidationResult {
	isValid: boolean;
	warnings: string[];
	errors: string[];
}

export class FrontmatterPropertyService {
	private static readonly YAML_FRONTMATTER_EXTENSIONS = ["md"];

	public constructor(private readonly app: App) {}

	public shouldPostProcessFrontMatter(
		file: TFile,
		templateVars: Map<string, unknown>,
	): boolean {
		return (
			FrontmatterPropertyService.YAML_FRONTMATTER_EXTENSIONS.includes(
				file.extension,
			) && templateVars.size > 0
		);
	}

	public validateStructuredVariables(
		templatePropertyVars: Map<string, unknown>,
	): ValidationResult {
		const warnings: string[] = [];
		const errors: string[] = [];

		for (const [key, value] of templatePropertyVars) {
			const issues = this.validateValue(key, value, new Set(), 0);
			warnings.push(...issues.warnings);
			errors.push(...issues.errors);
		}

		return { isValid: errors.length === 0, warnings, errors };
	}

	private validateValue(
		key: string,
		value: unknown,
		seen: Set<unknown>,
		depth: number,
	): { warnings: string[]; errors: string[] } {
		const warnings: string[] = [];
		const errors: string[] = [];

		if (typeof value === "function") {
			errors.push(
				`Variable "${key}" contains a function, which cannot be serialized to YAML`,
			);
			return { warnings, errors };
		}

		if (typeof value === "symbol") {
			errors.push(
				`Variable "${key}" contains a symbol, which cannot be serialized to YAML`,
			);
			return { warnings, errors };
		}

		if (typeof value === "bigint") {
			warnings.push(
				`Variable "${key}" contains a BigInt, which will be converted to a string`,
			);
			return { warnings, errors };
		}

		if (value === null || value === undefined) return { warnings, errors };
		if (typeof value !== "object") return { warnings, errors };

		if (seen.has(value)) {
			errors.push(`Variable "${key}" contains a circular reference`);
			return { warnings, errors };
		}

		if (depth >= VALIDATION_LIMITS.MAX_NESTING_DEPTH) {
			errors.push(
				`Variable "${key}" exceeds maximum nesting depth of ${VALIDATION_LIMITS.MAX_NESTING_DEPTH}`,
			);
			return { warnings, errors };
		}

		seen.add(value);

		try {
			if (Array.isArray(value)) {
				for (let i = 0; i < value.length; i++) {
					const childResult = this.validateValue(
						`${key}[${i}]`,
						value[i],
						seen,
						depth + 1,
					);
					warnings.push(...childResult.warnings);
					errors.push(...childResult.errors);
				}
			} else {
				for (const [childKey, childValue] of Object.entries(value)) {
					const childResult = this.validateValue(
						`${key}.${childKey}`,
						childValue,
						seen,
						depth + 1,
					);
					warnings.push(...childResult.warnings);
					errors.push(...childResult.errors);
				}
			}
		} finally {
			seen.delete(value);
		}

		return { warnings, errors };
	}

	public async postProcessFrontMatter(
		file: TFile,
		templatePropertyVars: Map<string, unknown>,
	): Promise<void> {
		const validation = this.validateStructuredVariables(templatePropertyVars);

		for (const warning of validation.warnings) {
			log.logWarning(`Structured variable validation warning: ${warning}`);
		}

		if (!validation.isValid) {
			const errorSummary = validation.errors.join("; ");
			log.logError(
				`Cannot post-process front matter for file ${file.path} due to validation errors: ${errorSummary}. ` +
					`The file was created successfully, but some structured variables may not be properly formatted. ` +
					`Please check the variable values and ensure they don't contain circular references, ` +
					`exceed nesting depth of ${VALIDATION_LIMITS.MAX_NESTING_DEPTH}, or contain unsupported types (functions, symbols).`,
			);
			return;
		}

		try {
			log.logMessage(
				`Post-processing front matter for ${file.path} with ${templatePropertyVars.size} structured variables`,
			);
			log.logMessage(
				`Variable types: ${Array.from(templatePropertyVars.entries())
					.map(([key, value]) => `${key}:${typeof value}`)
					.join(", ")}`,
			);

			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				for (const [key, value] of templatePropertyVars) {
					const pathSegments = key.includes(
						TemplatePropertyCollector.PATH_SEPARATOR,
					)
						? key.split(TemplatePropertyCollector.PATH_SEPARATOR)
						: [key];
					this.assignFrontmatterValue(
						frontmatter,
						pathSegments,
						coerceYamlValue(value),
					);
				}
			});

			log.logMessage(`Successfully post-processed front matter for ${file.path}`);
		} catch (err) {
			log.logError(
				`Failed to post-process front matter for file ${file.path}: ${err}. ` +
					`The file was created successfully, but structured variables may not be properly formatted. ` +
					`This usually happens when variable values contain unexpected types or when Obsidian's YAML processor encounters an issue. ` +
					`Check the console for more details about which variables caused the problem.`,
			);
		}
	}

	private assignFrontmatterValue(
		frontmatter: Record<string, unknown>,
		path: string[],
		value: unknown,
	): void {
		if (path.length === 0) return;
		let target = frontmatter;
		for (let i = 0; i < path.length - 1; i++) {
			const segment = path[i];
			const existing = target[segment];
			if (
				typeof existing !== "object" ||
				existing === null ||
				Array.isArray(existing)
			) {
				target[segment] = {};
			}
			target = target[segment] as Record<string, unknown>;
		}
		target[path[path.length - 1]] = value;
	}
}
