import type { App } from "obsidian";
import { GLOBAL_VAR_REGEX, TEMPLATE_REGEX, VARIABLE_REGEX } from "src/constants";
import { Formatter } from "src/formatters/formatter";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type QuickAdd from "src/main";
import { NLDParser } from "src/parsers/NLDParser";

export type FieldType =
	| "text"
	| "textarea"
	| "dropdown"
	| "date"
	| "field-suggest"
	| "file-picker"
	| "suggester";

export interface FieldRequirement {
	id: string; // variable key or special input id
	label: string; // user-facing label
	type: FieldType;
	description?: string;
	placeholder?: string;
	defaultValue?: string;
	options?: string[]; // for dropdowns and suggesters
	// Additional metadata
	dateFormat?: string; // for VDATE
	filters?: string; // serialized filters for FIELD variables
	source?: "collected" | "script"; // provenance for UX badges
	suggesterConfig?: {
		allowCustomInput?: boolean;
		caseSensitive?: boolean;
		multiSelect?: boolean;
	};
}

/**
 * RequirementCollector walks through strings that may contain QuickAdd format
 * syntax and records inputs we'd otherwise prompt for at runtime. It never
 * executes macros, scripts, or inline JavaScript. It returns inert replacements
 * so that formatting can continue to discover further requirements.
 */
export class RequirementCollector extends Formatter {
	public readonly requirements = new Map<string, FieldRequirement>();
	public readonly templatesToScan = new Set<string>();

	constructor(
		protected app: App,
		private plugin: QuickAdd,
		protected choiceExecutor?: IChoiceExecutor,
	) {
		super(app);
		this.dateParser = NLDParser;
		if (choiceExecutor) {
			// Use a shallow copy to avoid mutating the executor's live variables
			// during preflight scanning. This ensures unresolved detection works
			// and the One Page Input modal is shown when needed.
			this.variables = new Map(choiceExecutor.variables);
		}
	}

	// Entry points -------------------------------------------------------------
	public async scanString(input: string): Promise<void> {
		// Expand global variables first so we can detect inner requirements
		const expanded = await this.replaceGlobalVarInString(input);
		// Run a safe formatting pass that collects variables but avoids side-effects
		this.scanVariableTokens(expanded);
		await this.format(expanded);
	}

	protected async format(input: string): Promise<string> {
		let output = input;

		// NOTE: Intentionally skip macros, inline js, templates content resolution
		// We will only record the TEMPLATE references for later recursive scanning.

		// Expand global variables early (text-only expansion)
		output = await this.replaceGlobalVarInString(output);

		// Dates/Times
		output = this.replaceDateInString(output);
		output = this.replaceTimeInString(output);

		// VALUE & NAME
		output = await this.replaceValueInString(output);

		// Clipboard/Selected: keep inert
		output = await this.replaceSelectedInString(output);
		output = await this.replaceClipboardInString(output);

		// VDATE + VALUE variables + FIELD
		output = await this.replaceDateVariableInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceFieldVarInString(output);

		// Math value
		output = await this.replaceMathValueInString(output);

		// Random
		output = this.replaceRandomInString(output);

		// Record any template inclusions for callers to handle separately
		{
			const re = new RegExp(TEMPLATE_REGEX.source, "gi");
			let m: RegExpExecArray | null;
			while ((m = re.exec(output)) !== null) {
				const path = m[1];
				if (path) this.templatesToScan.add(path);
			}
		}

		return output;
	}

	protected async replaceGlobalVarInString(input: string): Promise<string> {
		let output = input;
		let guard = 0;
		const re = new RegExp(GLOBAL_VAR_REGEX.source, "gi");
		while (re.test(output)) {
			if (++guard > 5) break;
			output = output.replace(re, (_m, rawName) => {
				const name = String(rawName ?? "").trim();
				if (!name) return _m;
				const snippet = this.plugin?.settings?.globalVariables?.[name];
				return typeof snippet === "string" ? snippet : "";
			});
		}
		return output;
	}

	// Additional scanning for defaults/options in {{VALUE:...}} tokens
	private scanVariableTokens(input: string) {
		const re = new RegExp(VARIABLE_REGEX.source, "gi");
		let match: RegExpExecArray | null;
		while ((match = re.exec(input)) !== null) {
			const inner = (match[1] ?? "").trim();
			if (!inner) continue;

			const pipeIndex = inner.indexOf("|");
			let variableName = inner;
			let defaultValue: string | undefined;
			if (pipeIndex !== -1) {
				defaultValue = inner.substring(pipeIndex + 1).trim();
				variableName = inner.substring(0, pipeIndex).trim();
			}

			if (!variableName) continue;

			const hasOptions = pipeIndex === -1 && variableName.includes(",");
			if (!this.requirements.has(variableName)) {
				const req: FieldRequirement = {
					id: variableName,
					label: variableName,
					type: hasOptions ? "dropdown" : "text",
				};
				if (hasOptions) {
					req.options = variableName
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
				}
				if (defaultValue) req.defaultValue = defaultValue;
				this.requirements.set(variableName, req);
			} else if (defaultValue) {
				const existing = this.requirements.get(variableName)!;
				if (existing.defaultValue === undefined)
					existing.defaultValue = defaultValue;
			}
		}
	}

	// Formatter hooks ----------------------------------------------------------
	protected async promptForValue(header?: string): Promise<string> {
		const key = "value";
		if (!this.requirements.has(key)) {
			this.requirements.set(key, {
				id: key,
				label: header || "Enter value",
				type:
					this.plugin.settings.inputPrompt === "multi-line"
						? "textarea"
						: "text",
				source: "collected",
			});
		}
		return ""; // return inert value to keep scanning
	}

	protected async promptForVariable(
		variableName?: string,
		context?: { type?: string; dateFormat?: string; defaultValue?: string },
	): Promise<string> {
		if (!variableName) return "";

		// VDATE variables
		if (context?.type === "VDATE" && context.dateFormat) {
			if (!this.requirements.has(variableName)) {
				this.requirements.set(variableName, {
					id: variableName,
					label: variableName,
					type: "date",
					defaultValue: context.defaultValue,
					dateFormat: context.dateFormat,
					source: "collected",
				});
			}
			return context.defaultValue ?? "";
		}

		// Generic named variables
		if (!this.requirements.has(variableName)) {
			// Detect simple comma-separated option lists
			const hasOptions = variableName.includes(",");
			const req: FieldRequirement = {
				id: variableName,
				label: variableName,
				type: hasOptions ? "dropdown" : "text",
				source: "collected",
			};
			if (hasOptions) {
				req.options = variableName
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean);
			}
			if (context?.defaultValue) req.defaultValue = context.defaultValue;
			this.requirements.set(variableName, req);
		}

		return context?.defaultValue ?? "";
	}

	protected async promptForMathValue(): Promise<string> {
		const key = "mvalue";
		if (!this.requirements.has(key)) {
			this.requirements.set(key, {
				id: key,
				label: "Math expression",
				type: "text",
				placeholder: "e.g., 2+2*3",
			});
		}
		return "";
	}

	protected async suggestForField(variableName: string): Promise<string> {
		// Store as a field-suggest requirement; actual suggestions are provided by UI
		if (!this.requirements.has(variableName)) {
			this.requirements.set(variableName, {
				id: variableName,
				label: variableName,
				type: "field-suggest",
				source: "collected",
			});
		}
		return "";
	}

	protected async suggestForValue(_suggestedValues: string[]): Promise<string> {
		// No-op here because scanVariableTokens already records a requirement for
		// anonymous option lists (e.g., {{VALUE:low,medium,high}}) under the exact
		// token content as id, which the runtime formatter will look up.
		return "";
	}

	protected getVariableValue(variableName: string): string {
		// During collection, always resolve to empty string to continue scanning
		return "";
	}

	protected async getTemplateContent(_templatePath: string): Promise<string> {
		// Never read files here; caller scans template files separately
		return "";
	}

	protected async getSelectedText(): Promise<string> {
		return "";
	}
	protected async getClipboardContent(): Promise<string> {
		return "";
	}
	protected getCurrentFileLink(): string | null {
		return null;
	}
	protected getCurrentFileName(): string | null {
		return null;
	}
	protected async getMacroValue(_macroName: string): Promise<string> {
		return "";
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false; // Requirement collector doesn't need structured YAML variable handling
	}
}
