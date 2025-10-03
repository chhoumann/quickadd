import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
import { log } from "../logger/logManager";
import { coerceYamlValue } from "../utils/yamlValues";

/**
 * Configuration for structured variable validation
 */
const VALIDATION_LIMITS = {
	/** Maximum nesting depth for objects and arrays to prevent stack overflow */
	MAX_NESTING_DEPTH: 10,
} as const;

/**
 * Result of validating a structured variable
 */
interface ValidationResult {
	isValid: boolean;
	warnings: string[];
	errors: string[];
}

export abstract class QuickAddEngine {
	public app: App;

	/**
	 * File extensions that support YAML front matter post-processing.
	 * Currently only Markdown files are supported (Canvas files use JSON, not YAML).
	 */
	private static readonly YAML_FRONTMATTER_EXTENSIONS = ['md'];

	protected constructor(app: App) {
		this.app = app;
	}

	public abstract run(): void;

	/**
	 * Validates structured variables to ensure they can be safely processed.
	 * Checks for:
	 * - Circular references
	 * - Maximum nesting depth
	 * - Invalid types (functions, symbols, etc.)
	 *
	 * @param templatePropertyVars - Map of variables to validate
	 * @returns ValidationResult with any warnings or errors found
	 */
	protected validateStructuredVariables(templatePropertyVars: Map<string, unknown>): ValidationResult {
		const warnings: string[] = [];
		const errors: string[] = [];

		for (const [key, value] of templatePropertyVars) {
			const issues = this.validateValue(key, value, new Set(), 0);
			warnings.push(...issues.warnings);
			errors.push(...issues.errors);
		}

		return {
			isValid: errors.length === 0,
			warnings,
			errors,
		};
	}

	/**
	 * Recursively validates a value for circular references, depth limits, and invalid types.
	 *
	 * @param key - The key/path being validated (for error messages)
	 * @param value - The value to validate
	 * @param seen - Set of objects already seen (for circular reference detection)
	 * @param depth - Current nesting depth
	 * @returns Object containing arrays of warnings and errors
	 */
	private validateValue(
		key: string,
		value: unknown,
		seen: Set<unknown>,
		depth: number
	): { warnings: string[]; errors: string[] } {
		const warnings: string[] = [];
		const errors: string[] = [];

		// Check for invalid types
		if (typeof value === "function") {
			errors.push(`Variable "${key}" contains a function, which cannot be serialized to YAML`);
			return { warnings, errors };
		}

		if (typeof value === "symbol") {
			errors.push(`Variable "${key}" contains a symbol, which cannot be serialized to YAML`);
			return { warnings, errors };
		}

		if (typeof value === "bigint") {
			warnings.push(`Variable "${key}" contains a BigInt, which will be converted to a string`);
			return { warnings, errors };
		}

		// Handle null, undefined, primitives
		if (value === null || value === undefined) {
			return { warnings, errors };
		}

		if (typeof value !== "object") {
			return { warnings, errors };
		}

		// Check for circular references
		if (seen.has(value)) {
			errors.push(`Variable "${key}" contains a circular reference`);
			return { warnings, errors };
		}

		// Check nesting depth
		if (depth >= VALIDATION_LIMITS.MAX_NESTING_DEPTH) {
			errors.push(
				`Variable "${key}" exceeds maximum nesting depth of ${VALIDATION_LIMITS.MAX_NESTING_DEPTH}`
			);
			return { warnings, errors };
		}

		// Add to seen set for circular reference detection
		seen.add(value);

		try {
			// Recursively validate arrays
			if (Array.isArray(value)) {
				for (let i = 0; i < value.length; i++) {
					const childResult = this.validateValue(
						`${key}[${i}]`,
						value[i],
						seen,
						depth + 1
					);
					warnings.push(...childResult.warnings);
					errors.push(...childResult.errors);
				}
			}
			// Recursively validate objects
			else {
				for (const [childKey, childValue] of Object.entries(value)) {
					const childResult = this.validateValue(
						`${key}.${childKey}`,
						childValue,
						seen,
						depth + 1
					);
					warnings.push(...childResult.warnings);
					errors.push(...childResult.errors);
				}
			}
		} finally {
			// Remove from seen set after processing
			seen.delete(value);
		}

		return { warnings, errors };
	}

	protected async createFolder(folder: string): Promise<void> {
		const folderExists = await this.app.vault.adapter.exists(folder);

		if (!folderExists) {
			await this.app.vault.createFolder(folder);
		}
	}

	protected normalizeMarkdownFilePath(
		folderPath: string,
		fileName: string
	): string {
		const actualFolderPath: string = folderPath ? `${folderPath}/` : "";
		const formattedFileName: string = fileName.replace(
			MARKDOWN_FILE_EXTENSION_REGEX,
			""
		);
		return `${actualFolderPath}${formattedFileName}.md`;
	}

	protected async fileExists(filePath: string): Promise<boolean> {
		return await this.app.vault.adapter.exists(filePath);
	}

	protected getFileByPath(filePath: string): TFile {
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (!file) {
			log.logError(`${filePath} not found`);
			throw new Error(`${filePath} not found`);
		}

		if (file instanceof TFolder) {
			log.logError(`${filePath} found but it's a folder`);
			throw new Error(`${filePath} found but it's a folder`);
		}

		if (!(file instanceof TFile))
			throw new Error(`${filePath} is not a file`);

		return file;
	}

	protected async createFileWithInput(
		filePath: string,
		fileContent: string
	): Promise<TFile> {
		const dirMatch = filePath.match(/(.*)[/\\]/);
		let dirName = "";
		if (dirMatch) dirName = dirMatch[1];

		const dir = this.app.vault.getAbstractFileByPath(dirName);

		if (!dir || !(dir instanceof TFolder)) {
			await this.createFolder(dirName);

		}

		return await this.app.vault.create(filePath, fileContent);
	}

	/**
	 * Determines if a file's front matter should be post-processed for template property types.
	 * Only processes files with supported extensions (Markdown) when template variables are present.
	 *
	 * @param file - The file to check
	 * @param templateVars - The map of template variables to be processed
	 * @returns true if the file should be post-processed, false otherwise
	 */
	protected shouldPostProcessFrontMatter(file: TFile, templateVars: Map<string, unknown>): boolean {
		return QuickAddEngine.YAML_FRONTMATTER_EXTENSIONS.includes(file.extension) &&
		       templateVars.size > 0;
	}

	/**
	 * Post-processes the front matter of a newly created file to properly format
	 * template property variables (arrays, objects, etc.) using Obsidian's YAML processor.
	 *
	 * This method handles special internal conventions:
	 * - @date:ISO strings are automatically converted to Date objects for proper YAML formatting
	 *   (see coerceYamlValue in utils/yamlValues.ts for implementation details)
	 */
	protected async postProcessFrontMatter(file: TFile, templatePropertyVars: Map<string, unknown>): Promise<void> {
		// Validate structured variables before processing
		const validation = this.validateStructuredVariables(templatePropertyVars);

		// Log any validation warnings
		if (validation.warnings.length > 0) {
			for (const warning of validation.warnings) {
				log.logWarning(`Structured variable validation warning: ${warning}`);
			}
		}

		// If validation found errors, log them and skip post-processing
		if (!validation.isValid) {
			const errorSummary = validation.errors.join("; ");
			log.logError(
				`Cannot post-process front matter for file ${file.path} due to validation errors: ${errorSummary}. ` +
				`The file was created successfully, but some structured variables may not be properly formatted. ` +
				`Please check the variable values and ensure they don't contain circular references, ` +
				`exceed nesting depth of ${VALIDATION_LIMITS.MAX_NESTING_DEPTH}, or contain unsupported types (functions, symbols).`
			);
			return;
		}

		try {
			log.logMessage(`Post-processing front matter for ${file.path} with ${templatePropertyVars.size} structured variables`);
			log.logMessage(`Variable types: ${Array.from(templatePropertyVars.entries())
				.map(([k, v]) => `${k}:${typeof v}`).join(', ')}`);

			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				for (const [key, value] of templatePropertyVars) {
					// coerceYamlValue handles the @date:ISO -> Date conversion
					frontmatter[key] = coerceYamlValue(value);
				}
			});

			log.logMessage(`Successfully post-processed front matter for ${file.path}`);
		} catch (err) {
			// Improved error message with actionable information
			log.logError(
				`Failed to post-process front matter for file ${file.path}: ${err}. ` +
				`The file was created successfully, but structured variables may not be properly formatted. ` +
				`This usually happens when variable values contain unexpected types or when Obsidian's YAML processor encounters an issue. ` +
				`Check the console for more details about which variables caused the problem.`
			);
			// Don't throw - the file was still created successfully
		}
	}
}
