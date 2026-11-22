import type { App, TFile } from "obsidian";
import { processNoteFrontMatter } from "../../utils/noteContent";
import { log } from "../../logger/logManager";
import { coerceYamlValue } from "../../utils/yamlValues";
import { TemplatePropertyCollector } from "../../utils/TemplatePropertyCollector";

const VALIDATION_LIMITS = {
	MAX_NESTING_DEPTH: 10,
} as const;

/** Canvas files are JSON, so only Markdown gets YAML front matter. */
const YAML_FRONTMATTER_EXTENSIONS = ["md"];

interface ValidationResult {
	isValid: boolean;
	warnings: string[];
	errors: string[];
}

export function validateStructuredVariables(
	templatePropertyVars: Map<string, unknown>,
): ValidationResult {
	const warnings: string[] = [];
	const errors: string[] = [];

	for (const [key, value] of templatePropertyVars) {
		const issues = validateValue(key, value, new Set(), 0);
		warnings.push(...issues.warnings);
		errors.push(...issues.errors);
	}

	return {
		isValid: errors.length === 0,
		warnings,
		errors,
	};
}

function validateValue(
	key: string,
	value: unknown,
	seen: Set<unknown>,
	depth: number,
): { warnings: string[]; errors: string[] } {
	const warnings: string[] = [];
	const errors: string[] = [];

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

	if (value === null || value === undefined) {
		return { warnings, errors };
	}

	if (typeof value !== "object") {
		return { warnings, errors };
	}

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
				const childResult = validateValue(
					`${key}[${i}]`,
					value[i],
					seen,
					depth + 1,
				);
				warnings.push(...childResult.warnings);
				errors.push(...childResult.errors);
			}
		}
		else {
			for (const [childKey, childValue] of Object.entries(value)) {
				const childResult = validateValue(
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

export function shouldPostProcessFrontMatter(
	file: TFile,
	templateVars: Map<string, unknown>,
): boolean {
	return (
		YAML_FRONTMATTER_EXTENSIONS.includes(file.extension) &&
		templateVars.size > 0
	);
}

/**
 * Rewrites template property variables through Obsidian's YAML processor.
 * `@date:ISO` strings become Dates (see coerceYamlValue).
 */
export async function postProcessFrontMatter(
	app: App,
	file: TFile,
	templatePropertyVars: Map<string, unknown>,
): Promise<void> {
	const validation = validateStructuredVariables(templatePropertyVars);

	if (validation.warnings.length > 0) {
		for (const warning of validation.warnings) {
			log.logWarning(`Structured variable validation warning: ${warning}`);
		}
	}

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

		await processNoteFrontMatter(app, file, (frontmatter) => {
			for (const [key, value] of templatePropertyVars) {
				const pathSegments = key.includes(TemplatePropertyCollector.PATH_SEPARATOR)
					? key.split(TemplatePropertyCollector.PATH_SEPARATOR)
					: [key];
				const coerced = coerceYamlValue(value);
				assignFrontmatterValue(frontmatter, pathSegments, coerced);
			}
		});

		log.logMessage(`Successfully post-processed front matter for ${file.path}`);
	} catch (err) {
		log.logError(
			`Failed to post-process front matter for file ${file.path}: ${err}. ` +
			`The file was created successfully, but structured variables may not be properly formatted. ` +
			`This usually happens when variable values contain unexpected types or when Obsidian's YAML processor encounters an issue. ` +
			`Check the console for more details about which variables caused the problem.`
		);
	}
}

/**
 * These only pollute a prototype when descended through. As leaf keys they are
 * plain own-property writes and legitimate metadata names.
 */
const UNSAFE_DESCENT_SEGMENTS = new Set(["prototype", "constructor"]);

/**
 * True when writing along this key path would corrupt JS prototype state.
 * `__proto__` is unsafe anywhere (descent pollutes Object.prototype, a leaf
 * write reparents the object); `constructor`/`prototype` only as non-terminal
 * segments. Segments are trimmed upstream, so exact matching is sufficient.
 */
export function hasUnsafeFrontmatterKey(path: string[]): boolean {
	return path.some((segment, index) => {
		if (segment === "__proto__") return true;
		const isTerminal = index === path.length - 1;
		return !isTerminal && UNSAFE_DESCENT_SEGMENTS.has(segment);
	});
}

export function assignFrontmatterValue(
	frontmatter: Record<string, unknown>,
	path: string[],
	value: unknown,
): void {
	if (path.length === 0) return;
	// Key paths can come from synced or imported content.
	if (hasUnsafeFrontmatterKey(path)) {
		log.logWarning(
			`Skipping front matter assignment for unsafe key path "${path.join(".")}" to avoid prototype pollution.`,
		);
		return;
	}
	let target = frontmatter;
	for (let i = 0; i < path.length - 1; i++) {
		const segment = path[i];
		const existing = target[segment];
		if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
			target[segment] = {};
		}
		target = target[segment] as Record<string, unknown>;
	}
	target[path[path.length - 1]] = value;
}
