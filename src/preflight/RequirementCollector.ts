import type { App } from "obsidian";
import {
	DATE_VARIABLE_REGEX,
	FIELD_VARIABLE_PREFIX,
	FILE_REGEX,
	GLOBAL_VAR_REGEX,
	MATH_VALUE_REGEX,
	NAME_VALUE_REGEX,
	TEMPLATE_REGEX,
	VARIABLE_REGEX,
} from "src/constants";
import { Formatter, type PromptContext } from "src/formatters/formatter";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type QuickAdd from "src/main";
import { NLDParser } from "src/parsers/NLDParser";
import {
	parseValueToken,
	splitQuotedCommaList,
	type NumericInputConfig,
	type SliderConfig,
	unwrapQuotedValue,
} from "src/utils/valueSyntax";
import { parseVDateOptions } from "src/utils/vdateSyntax";
import { EnhancedFieldSuggestionFileFilter } from "src/utils/EnhancedFieldSuggestionFileFilter";
import { FieldSuggestionParser } from "src/utils/FieldSuggestionParser";
import { resolveActiveNoteFieldDefault } from "src/utils/activeNoteFieldDefault";
import {
	buildFileDisplayLabels,
	FILE_PICK_PREFIX,
	type ParsedFileToken,
	parseFileToken,
} from "src/utils/fileSyntax";

export type FieldType =
	| "text"
	| "number"
	| "textarea"
	| "dropdown"
	| "slider"
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
	numericConfig?: NumericInputConfig;
	sliderConfig?: SliderConfig;
	options?: string[]; // for dropdowns and suggesters
	displayOptions?: string[]; // visible labels for mapped VALUE lists
	// Additional metadata
	dateFormat?: string; // for VDATE
	withTime?: boolean; // VDATE |time/|datetime: render a date AND time picker
	multiEmit?: "text" | "linklist"; // |multi:linklist wraps picks as [[name]]
	filters?: string; // serialized filters for FIELD variables
	source?: "collected" | "script"; // provenance for UX badges
	/**
	 * True when ANY scanned occurrence of the variable sits in a path-context
	 * string (file name format, folder path, capture target, insert-after/
	 * before targets, template path). Sticky: one path usage disables
	 * image paste for the field - an embed link in a path would corrupt it
	 * (issue #1484). Content-only fields stay unset.
	 */
	pathContext?: boolean;
	/** Prompt at runtime instead of the one-page form when the form has no safe widget. */
	runtimeOnly?: boolean;
	/** True only when EVERY scanned occurrence of the variable is |optional. */
	optional?: boolean;
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
	/**
	 * Cross-branch memo for the template-inclusion walk: `<context>:<ref>`
	 * (context = "path" | "content") → the shallowest depth the template was
	 * fully scanned at during this collection. Requirements dedupe by id, so
	 * re-scanning a template reachable through many distinct paths adds
	 * nothing - without this memo a dense template DAG fans out as
	 * branching^depth (~1M scans at 4×10), freezing the UI. Keyed per context
	 * because a content-scanned template reached again from a path string
	 * must be re-walked to taint its variables as path context (#1484).
	 */
	public readonly scannedTemplateRefDepths = new Map<string, number>();

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

	/**
	 * True while the current scanString walks a path-context string. Flows
	 * into FieldRequirement.pathContext (sticky across occurrences).
	 */
	private scanningPathContext = false;

	// Entry points -------------------------------------------------------------
	public async scanString(input: string, pathContext = false): Promise<void> {
		const previousContext = this.scanningPathContext;
		this.scanningPathContext = pathContext;
		try {
			// Expand global variables first so we can detect inner requirements
			const expanded = await this.replaceGlobalVarInString(input);
			// Run a safe formatting pass that collects variables but avoids side-effects
			this.scanVariableTokens(expanded);
			this.scanDateTokens(expanded);
			this.scanFileTokens(expanded);
			// Anonymous {{VALUE}}/{{NAME}} and {{MVALUE}} resolutions are
			// cached, so their prompt hooks fire once per collector; a path
			// string scanned AFTER a content string that already registered
			// them must still taint them (named variables get per-occurrence
			// marking in scanVariableTokens; these singleton tokens need this
			// textual re-check).
			if (pathContext) {
				if (new RegExp(NAME_VALUE_REGEX.source, "i").test(expanded)) {
					const anonymousValue = this.requirements.get("value");
					if (anonymousValue) anonymousValue.pathContext = true;
				}
				if (new RegExp(MATH_VALUE_REGEX.source, "i").test(expanded)) {
					const mathValue = this.requirements.get("mvalue");
					if (mathValue) mathValue.pathContext = true;
				}
			}
			await this.format(expanded);
		} finally {
			this.scanningPathContext = previousContext;
		}
	}

	/** Sticky path-context marking: one path occurrence taints the field. */
	private markScanContext(req: FieldRequirement): void {
		if (this.scanningPathContext) req.pathContext = true;
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
		output = await this.replaceFileInString(output);

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

			const parsed = parseValueToken(inner);
			if (!parsed) continue;

			const {
				variableName,
				variableKey,
				label,
				defaultValue,
				displayValues,
				hasOptions,
			} = parsed;

			if (!variableName) continue;

			const displayLabel = hasOptions && label ? label : variableName;
			const description = !hasOptions && label ? label : undefined;
			const requirementId = variableKey;

			if (!this.requirements.has(requirementId)) {
				// |type:checkbox renders a forced true/false dropdown and
				// |type:number a numeric input, so the one-page form matches the
				// runtime suggester/prompt (item #757).
				const isCheckbox =
					!hasOptions && parsed.inputTypeOverride === "checkbox";
				const isNumber =
					!hasOptions && parsed.inputTypeOverride === "number";
				const isSlider =
					!hasOptions && parsed.inputTypeOverride === "slider";
				const baseInputType: FieldType =
					parsed.inputTypeOverride === "multiline" ||
					this.plugin.settings.inputPrompt === "multi-line"
						? "textarea"
						: "text";
				const req: FieldRequirement = {
					id: requirementId,
					label: displayLabel,
					type: hasOptions
						? this.optionFieldType(parsed)
						: isCheckbox
							? "dropdown"
							: isNumber
								? "number"
								: isSlider
									? "slider"
									: baseInputType,
					description,
					optional: parsed.optional,
				};
				if (hasOptions) this.applyOptionFields(req, parsed);
				else if (isCheckbox) req.options = ["true", "false"];
				else if (isNumber) req.numericConfig = parsed.numericConfig;
				else if (isSlider) {
					req.numericConfig = parsed.numericConfig;
					req.sliderConfig = parsed.sliderConfig;
				}
				if (defaultValue) req.defaultValue = defaultValue;
				this.markScanContext(req);
				this.requirements.set(requirementId, req);
			} else {
				const existing = this.requirements.get(requirementId)!;
				this.markScanContext(existing);
				// Order-independent named reuse: when a later occurrence carries
				// the option list ({{VALUE:a,b|name:x}}) but the requirement was
				// first recorded option-less (a bare {{VALUE:x}} reuse seen
				// earlier, in this or a prior scanned string), upgrade it in place
				// so the one-page form renders the dropdown/suggester either way.
				if (hasOptions && !this.hasOptionList(existing)) {
					existing.type = this.optionFieldType(parsed);
					existing.label = displayLabel;
					this.applyOptionFields(existing, parsed);
					// Drop a stale text-era default the upgraded control can't keep.
					// A non-custom dropdown stores raw option values, so a default
					// that isn't one (incl. a display label) would be normalized to
					// the first option anyway — clear it for an honest empty start.
					// The suggester/custom path accepts free text, so keep it.
					// The original default was recorded option-less, so unwrap any
					// quotes now (the option list is unquoted) before matching, so a
					// quoted comma default like |default:"a, b" still pre-selects.
					if (existing.defaultValue !== undefined && !parsed.allowCustomInput) {
						const unwrapped = unwrapQuotedValue(existing.defaultValue);
						existing.defaultValue = parsed.suggestedValues.includes(
							unwrapped,
						)
							? unwrapped
							: undefined;
					}
				}
				if (defaultValue && existing.defaultValue === undefined)
					existing.defaultValue = defaultValue;
				if (!existing.displayOptions && displayValues) {
					existing.displayOptions = displayValues;
				}
				// AND rule: the field is optional only if every occurrence is.
				existing.optional = (existing.optional ?? false) && parsed.optional;
			}
		}
	}

	private optionFieldType(parsed: {
		allowCustomInput: boolean;
		multiSelect?: boolean;
	}): FieldType {
		// Multi-select needs the suggester widget (the dropdown is single-value).
		return parsed.allowCustomInput || parsed.multiSelect
			? "suggester"
			: "dropdown";
	}

	private hasOptionList(req: FieldRequirement): boolean {
		return Array.isArray(req.options) && req.options.length > 0;
	}

	private applyOptionFields(
		req: FieldRequirement,
		parsed: {
			suggestedValues: string[];
			displayValues?: string[];
			allowCustomInput: boolean;
			multiSelect?: boolean;
			multiEmit?: "text" | "linklist";
		},
	): void {
		req.options = parsed.suggestedValues;
		if (parsed.displayValues) req.displayOptions = parsed.displayValues;
		if (parsed.multiSelect) req.multiEmit = parsed.multiEmit ?? "text";
		else delete req.multiEmit;
		// A suggesterConfig is needed for EITHER a custom-input OR a multi-select
		// token (the two are independent — |multi without |custom must still
		// enable multiSelect on the one-page picker).
		if (parsed.allowCustomInput || parsed.multiSelect) {
			req.suggesterConfig = {
				allowCustomInput: parsed.allowCustomInput,
				caseSensitive: false,
				multiSelect: parsed.multiSelect ?? false,
			};
		} else {
			delete req.suggesterConfig;
		}
	}

	/**
	 * Textual VDATE scan, mirroring scanVariableTokens. The inherited
	 * replaceDateVariableInString prompts (and therefore records) only once
	 * per variable, so per-occurrence |optional flags would never reach the
	 * promptForVariable hook — this scan records them all and applies the
	 * same AND rule across occurrences and across scanned strings.
	 */
	private scanDateTokens(input: string) {
		const re = new RegExp(DATE_VARIABLE_REGEX.source, "gi");
		let match: RegExpExecArray | null;
		while ((match = re.exec(input)) !== null) {
			const variableName = match[1]?.trim();
			if (!variableName) continue;

			const { defaultValue, optional, withTime } = parseVDateOptions(
				match[3],
			);
			const dateFormat =
				match[2]?.trim() || (withTime ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD");

			const existing = this.requirements.get(variableName);
			if (!existing) {
				this.requirements.set(variableName, {
					id: variableName,
					label: variableName,
					type: "date",
					defaultValue,
					dateFormat,
					withTime,
					optional,
					source: "collected",
				});
			} else {
				// Only backfill date metadata onto date requirements — a
				// same-name VALUE requirement must not inherit a VDATE default.
				if (
					existing.type === "date" &&
					defaultValue &&
					existing.defaultValue === undefined
				)
					existing.defaultValue = defaultValue;
				existing.optional = (existing.optional ?? false) && optional;
				// If ANY occurrence of the reused date wants a time picker, the
				// shared control must offer one (and a datetime format).
				if (existing.type === "date" && withTime && !existing.withTime) {
					existing.withTime = true;
					if (!match[2]?.trim()) existing.dateFormat = "YYYY-MM-DD HH:mm";
				}
			}
		}
	}

	// Formatter hooks ----------------------------------------------------------
	protected async promptForValue(header?: string): Promise<string> {
		const key = "value";
		if (!this.requirements.has(key)) {
			const isCheckbox =
				this.valuePromptContext?.inputTypeOverride === "checkbox";
			const isNumber =
				this.valuePromptContext?.inputTypeOverride === "number";
			const isSlider =
				this.valuePromptContext?.inputTypeOverride === "slider";
			this.requirements.set(key, {
				id: key,
				label: header || "Enter value",
				type:
					isCheckbox
						? "dropdown"
						: isNumber
							? "number"
							: isSlider
								? "slider"
								: this.valuePromptContext?.inputTypeOverride === "multiline" ||
									  this.plugin.settings.inputPrompt === "multi-line"
						? "textarea"
						: "text",
				description: this.valuePromptContext?.description,
				defaultValue: this.valuePromptContext?.defaultValue,
				numericConfig: this.valuePromptContext?.numericConfig,
				sliderConfig: this.valuePromptContext?.sliderConfig,
				options: isCheckbox ? ["true", "false"] : undefined,
				source: "collected",
				optional: this.valuePromptContext?.optional,
			});
		}
		// This hook fires once per collector ({{VALUE}} resolution is cached),
		// but path strings are always scanned before content strings by the
		// per-choice collectors, so a dual-use anonymous VALUE is first seen -
		// and marked - in path context. The sticky mark below also covers the
		// already-registered case for safety.
		this.markScanContext(this.requirements.get(key)!);
		return ""; // return inert value to keep scanning
	}

	protected async promptForVariable(
		variableName?: string,
		context?: PromptContext,
	): Promise<string> {
		if (!variableName) return "";
		const key = context?.variableKey ?? variableName;

		// VDATE variables: requirements are recorded by scanDateTokens, which
		// sees every textual occurrence (this hook fires at most once per
		// variable and would record first-occurrence flags without the AND
		// rule). Just return an inert value to keep scanning.
		if (context?.type === "VDATE") {
			return context.defaultValue ?? "@date:1970-01-01T00:00:00.000Z";
		}

		// Generic named variables
		if (!this.requirements.has(key)) {
			// Detect comma-separated option lists, honoring quoted commas the same
			// way parseValueToken does so this fallback can never disagree with the
			// runtime split (e.g. a single quoted option stays one value, not a
			// bogus dropdown).
			const optionValues = splitQuotedCommaList(variableName)
				.map((s) => s.trim())
				.filter(Boolean);
			const hasOptions = optionValues.length > 1;
			const isNumber = !hasOptions && context?.inputTypeOverride === "number";
			const isSlider = !hasOptions && context?.inputTypeOverride === "slider";
			const isCheckbox =
				!hasOptions && context?.inputTypeOverride === "checkbox";
			const baseInputType =
				context?.inputTypeOverride === "multiline" ||
				this.plugin.settings.inputPrompt === "multi-line"
					? "textarea"
					: "text";
			const req: FieldRequirement = {
				id: key,
				label: variableName,
				type: hasOptions
					? "dropdown"
					: isCheckbox
						? "dropdown"
						: isNumber
							? "number"
							: isSlider
								? "slider"
								: baseInputType,
				description: context?.description,
				numericConfig: context?.numericConfig,
				sliderConfig: context?.sliderConfig,
				source: "collected",
			};
			if (hasOptions) {
				req.options = optionValues;
			} else if (isCheckbox) {
				req.options = ["true", "false"];
			}
			if (context?.defaultValue) req.defaultValue = context.defaultValue;
			this.requirements.set(key, req);
		}
		this.markScanContext(this.requirements.get(key)!);

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
		// {{MVALUE}} is legal in path strings too; taint like the VALUE hooks
		// so its free-text field never offers image paste there (#1484). This
		// hook fires once per collector, but path strings are scanned first.
		this.markScanContext(this.requirements.get(key)!);
		return "";
	}

	protected async suggestForField(variableName: string): Promise<string> {
		// Key the requirement with the runtime "FIELD:" prefix so values entered
		// in the one-page form land where replaceFieldVarInString looks them up
		// (issue #1184). Actual suggestions are provided by the UI.
		const parsed = FieldSuggestionParser.parse(variableName);
		const key = `${FIELD_VARIABLE_PREFIX}${variableName}`;
		if (!this.requirements.has(key)) {
			const requirement: FieldRequirement = {
				id: key,
				label: parsed.fieldName || variableName,
				type: "field-suggest",
				source: "collected",
				runtimeOnly: parsed.multiSelect,
			};
			// Single-select |default-from:active (issue #1429): resolve the active
			// note's current value so the one-page form prefills it (OnePageInputModal
			// reads req.defaultValue as the starting value). Gate strictly on "active".
			// Multi FIELD is runtimeOnly — it bypasses the one-page form and preselects
			// at runtime in the MultiSuggester instead, so it sets no defaultValue here.
			if (!parsed.multiSelect && parsed.filters.defaultFrom === "active") {
				const resolved = resolveActiveNoteFieldDefault(
					this.app,
					this.choiceExecutor?.triggerContext?.activeFile ?? null,
					parsed.fieldName,
				);
				// The active value wins; when it resolves nothing (no active note,
				// missing/empty property) fall back to the literal |default: so the
				// one-page form matches the runtime path, which still prepends that
				// default. `{{FIELD:x|default:Inbox|default-from:active}}` therefore
				// prefills Inbox instead of an empty field.
				const effectiveDefault =
					(typeof resolved === "string" ? resolved : undefined) ??
					parsed.filters.defaultValue;
				if (effectiveDefault !== undefined) {
					requirement.defaultValue = effectiveDefault;
				}
			}
			this.requirements.set(key, requirement);
		}
		return "";
	}

	/**
	 * Records {{FILE:...}} requirements so they're visible up front (one-page form
	 * + non-interactive CLI) instead of ambushing with a runtime picker. Like
	 * scanVariableTokens/scanDateTokens, this scans EVERY occurrence — the
	 * inherited replaceFileInString prompt hook fires at most once per key (it
	 * caches the first inert answer), so per-occurrence flags such as |optional
	 * would otherwise never be merged.
	 */
	private scanFileTokens(input: string) {
		const re = new RegExp(FILE_REGEX.source, "gi");
		let match: RegExpExecArray | null;
		while ((match = re.exec(input)) !== null) {
			const parsed = parseFileToken(match[1] ?? "");
			if (!parsed) continue;
			this.recordFileRequirement(parsed);
		}
	}

	private recordFileRequirement(parsed: ParsedFileToken): void {
		const key = parsed.variableKey;
		const existing = this.requirements.get(key);
		if (existing) {
			// A repeated key (same identity, or a shared |name:). Apply the same
			// AND rule as VALUE/VDATE: optional only if EVERY occurrence is
			// optional, so a later required use still prompts.
			existing.optional = (existing.optional ?? false) && parsed.optional;
			// Merge custom-input capability order-independently: if ANY occurrence
			// allows custom input, the shared field must expose the free-text
			// suggester (most-permissive wins, mirroring VALUE's option upgrade).
			if (parsed.allowCustomInput) {
				existing.type = "suggester";
				existing.suggesterConfig = {
					allowCustomInput: true,
					caseSensitive: false,
					multiSelect: parsed.multiSelect,
				};
			}
			if (parsed.multiSelect) {
				existing.type = "suggester";
				existing.runtimeOnly = true;
				existing.suggesterConfig = {
					allowCustomInput:
						existing.suggesterConfig?.allowCustomInput ??
						parsed.allowCustomInput,
					caseSensitive: false,
					multiSelect: true,
				};
			}
			return;
		}

		// Options are the folder's files encoded as `@file:<path>` (display =
		// basenames) so the chosen value round-trips to the runtime formatter,
		// which decodes it back to the file.
		const files = EnhancedFieldSuggestionFileFilter.filterFiles(
			this.app.vault.getMarkdownFiles(),
			parsed.filter,
			(file) => this.app.metadataCache.getFileCache(file),
		);
		const options = files.map((file) => `${FILE_PICK_PREFIX}${file.path}`);
		const displayOptions = buildFileDisplayLabels(
			files,
			(file) => this.app.metadataCache.getFileCache(file),
		);
		// A non-custom FILE is a FORCED choice: render it as a dropdown so the
		// one-page form can't store a raw typed value (a free-text suggester would
		// let "type name + Enter" bypass the option list, mirroring the runtime
		// GenericSuggester vs InputSuggester split). Fall back to a suggester (free
		// text) when |custom, or when the folder is empty so the field isn't a
		// dead, disabled dropdown.
		const useSuggester =
			parsed.allowCustomInput || parsed.multiSelect || options.length === 0;
		// Disambiguate same-scope tokens that differ only by mode (e.g. a basename
		// and a link to the same folder) when no explicit |label.
		const autoLabel =
			parsed.mode === "name"
				? `File from ${parsed.folderPath}`
				: `File from ${parsed.folderPath} (${parsed.mode})`;
		this.requirements.set(key, {
			id: key,
			label: parsed.label ?? autoLabel,
			type: useSuggester ? "suggester" : "dropdown",
			source: "collected",
			options,
			displayOptions,
			optional: parsed.optional,
			runtimeOnly: parsed.multiSelect,
			...(useSuggester
				? {
						suggesterConfig: {
							allowCustomInput: parsed.allowCustomInput,
							caseSensitive: false,
							multiSelect: parsed.multiSelect,
						},
					}
				: {}),
		});
	}

	protected suggestForFile(_parsed: ParsedFileToken): string {
		// Requirements are recorded by scanFileTokens (which sees every
		// occurrence). This hook fires at most once per key, so it stays inert.
		return "";
	}

	protected async suggestForValue(
		_suggestedValues: string[],
		_allowCustomInput?: boolean,
		_context?: { placeholder?: string; variableKey?: string },
	): Promise<string> {
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
	protected async getMacroValue(
		_macroName: string,
		_context?: { label?: string },
	): Promise<string> {
		return "";
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false; // Requirement collector doesn't need structured YAML variable handling
	}
}
