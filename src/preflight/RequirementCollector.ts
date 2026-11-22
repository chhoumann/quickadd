import { unescapePipesInTokens } from "src/utils/pipeEscapes";
import { normalizeVaultPath } from "../utils/pathUtils";
import type { App } from "obsidian";
import {
	DATE_VARIABLE_REGEX,
	FIELD_VAR_REGEX_WITH_FILTERS,
	FIELD_VARIABLE_PREFIX,
	FILE_REGEX,
	MATH_VALUE_REGEX,
	NAME_VALUE_REGEX,
	TEMPLATE_REGEX,
	VARIABLE_REGEX,
} from "src/constants";
import { Formatter, type PromptContext } from "src/formatters/formatter";
import {
	describeValuePrompt,
	valueAnswersWholeScope,
	type PromptScopeKind,
} from "src/formatters/promptScope";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type { SettingsProvider } from "src/types/pluginContext";
import { NLDParser } from "src/parsers/NLDParser";
import {
	parseValueToken,
	splitQuotedCommaList,
	unwrapQuotedValue,
} from "src/utils/valueSyntax";
import { parseVDateOptions } from "src/utils/vdateSyntax";
import { FieldSuggestionParser } from "src/utils/FieldSuggestionParser";
import { resolveActiveNoteFieldDefault } from "src/utils/activeNoteFieldDefault";
import {
	buildFileDisplayInfos,
	FILE_PICK_PREFIX,
	type ParsedFileToken,
	parseFileToken,
} from "src/utils/fileSyntax";
import { getFileTokenFiles } from "src/utils/vaultQueries";

export type { FieldRequirement, FieldGroup } from "./fieldRequirements";
import type { FieldType, FieldRequirement } from "./fieldRequirements";
import { defaultDateVariableFormat, encodeDateToken } from "../utils/dateTokenCodec";
import { uniqueKeyIgnoringCase } from "../utils/uniqueKeyIgnoringCase";

const OPTION_LIST_LABEL_MAX = 30;

/** "happy / sad"; whole options only, then "…" once past the limit. */
function optionListLabel(options: string[]): string {
	let label = options[0];
	for (const option of options.slice(1)) {
		const next = `${label} / ${option}`;
		if (next.length > OPTION_LIST_LABEL_MAX) return `${label}…`;
		label = next;
	}
	return label;
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
	 * `<context>:<ref>` → the shallowest depth the template was fully scanned at.
	 * Requirements dedupe by id, so without this memo a dense template DAG fans
	 * out exponentially. Keyed per context because a template reached again from
	 * a path string must be re-walked to mark its variables as path context.
	 */
	public readonly scannedTemplateRefDepths = new Map<string, number>();

	constructor(
		protected app: App,
		protected plugin: SettingsProvider,
		protected choiceExecutor?: IChoiceExecutor,
	) {
		super(app);
		this.dateParser = NLDParser;
		if (choiceExecutor) {
			// A copy, so preflight never mutates the executor's live variables.
			this.variables = new Map(choiceExecutor.variables);
		}
	}

	/** The run owns authoring warnings; the scan walks the same strings and would repeat them. */
	protected warn(): void {}
	// Nothing routes here today; kept quiet for the same reason as warn().
	protected reportProblem(): void {}

	/**
	 * True while the current scanString walks a path-context string. Flows
	 * into FieldRequirement.pathContext (sticky across occurrences).
	 */
	private scanningPathContext = false;
	/**
	 * What the string being scanned becomes, so the one-page form labels the
	 * anonymous {{VALUE}} field like the sequential prompt titles it.
	 */
	private scanningScope: PromptScopeKind = "generic";
	/** Set while scanning a One entry per line Capture's format: its {{VALUE}} takes several lines. */
	public valueTakesLines = false;
	private scanningSoleValue = false;
	/**
	 * Where each field first appears in the string being scanned, so the form
	 * lists fields in the order the format reads rather than by token type.
	 */
	private scanPositions = new Map<string, number>();

	public async scanString(
		input: string,
		pathContext = false,
		scope: PromptScopeKind = "generic",
	): Promise<void> {
		const previousContext = this.scanningPathContext;
		const previousScope = this.scanningScope;
		const previousSoleValue = this.scanningSoleValue;
		this.scanningPathContext = pathContext;
		this.scanningScope = scope;
		this.scanningSoleValue = valueAnswersWholeScope(scope, input);
		const known = new Set(this.requirements.keys());
		this.scanPositions = new Map();
		try {
			const expanded = unescapePipesInTokens(
				await this.replaceGlobalVarInString(input),
			);
			// Dates first, as the run replaces VDATEs before named VALUEs, so a
			// {{VALUE:<name>}} reuse of a VDATE answer keeps the field a date.
			this.scanDateTokens(expanded);
			this.scanVariableTokens(expanded);
			this.scanFileTokens(expanded);
			// Anonymous VALUE/NAME and MVALUE resolve once per collector, so a
			// path string scanned after a content string must still mark them.
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
			this.orderNewFieldsByPosition(known, expanded);
		} finally {
			this.scanningPathContext = previousContext;
			this.scanningScope = previousScope;
			this.scanningSoleValue = previousSoleValue;
		}
	}

	/**
	 * Lists the fields this string added in the order they first appear in it.
	 * Fields from earlier strings (a file name, an earlier macro step) keep
	 * their place ahead of them.
	 */
	private orderNewFieldsByPosition(known: Set<string>, input: string): void {
		this.notePosition("value", input.search(NAME_VALUE_REGEX));
		this.notePosition("mvalue", input.search(MATH_VALUE_REGEX));
		const fieldTokens = new RegExp(FIELD_VAR_REGEX_WITH_FILTERS.source, "gi");
		for (const match of input.matchAll(fieldTokens)) {
			this.notePosition(
				this.fieldRequirementId(`${match[1]}${match[2] ?? ""}`),
				match.index,
			);
		}

		const added = [...this.requirements].filter(([id]) => !known.has(id));
		const position = (id: string) =>
			this.scanPositions.get(id) ?? Number.MAX_SAFE_INTEGER;
		added.sort(([a], [b]) => position(a) - position(b));
		for (const [id] of added) this.requirements.delete(id);
		for (const [id, requirement] of added) this.requirements.set(id, requirement);
	}

	private notePosition(id: string, index: number): void {
		if (index < 0) return;
		const seen = this.scanPositions.get(id);
		if (seen === undefined || index < seen) this.scanPositions.set(id, index);
	}

	/** Sticky path-context marking: one path occurrence taints the field. */
	private markScanContext(req: FieldRequirement): void {
		if (this.scanningPathContext) req.pathContext = true;
	}

	protected async format(input: string): Promise<string> {
		let output = input;

		// Never resolves macros, inline JS or template content; template
		// references are recorded for the caller to scan.

		output = await this.replaceGlobalVarInString(output);

		output = this.replaceDateInString(output);
		output = this.replaceTimeInString(output);

		output = await this.replaceValueInString(output);

		output = await this.replaceSelectedInString(output);
		output = await this.replaceClipboardInString(output);

		output = await this.replaceDateVariableInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceFieldVarInString(output);
		output = await this.replaceFileInString(output);

		output = await this.replaceMathValueInString(output);

		output = this.replaceRandomInString(output);

		{
			const re = new RegExp(TEMPLATE_REGEX.source, "gi");
			let m: RegExpExecArray | null;
			while ((m = re.exec(output)) !== null) {
				const path = m[1];
				if (path) this.templatesToScan.add(normalizeVaultPath(path));
			}
		}

		return output;
	}

	private scanVariableTokens(input: string) {
		const re = new RegExp(VARIABLE_REGEX.source, "gi");
		let match: RegExpExecArray | null;
		while ((match = re.exec(input)) !== null) {
			const inner = (match[1] ?? "").trim();
			if (!inner) continue;

			// Explicit sink: this is a direct module-level call, so the hook
			// overrides above do not cover it.
			const parsed = parseValueToken(inner, { warn: this.warnSink });
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

			// An option list's spec ("happy,sad") is its id, not a readable label.
			const displayLabel =
				label ??
				(hasOptions
					? (parsed.aliasName ??
						optionListLabel(displayValues ?? parsed.suggestedValues))
					: variableName);
			const requirementId = variableKey;

			// A VDATE with this name asks first at run time, which matches names
			// case-insensitively, so this VALUE only reuses the date.
			const reusedDate = this.findRequirementIgnoringCase(requirementId, "date");
			this.notePosition(reusedDate?.id ?? requirementId, match.index);
			if (reusedDate) {
				this.markScanContext(reusedDate);
				continue;
			}

			if (!this.requirements.has(requirementId)) {
				// So the one-page form matches the runtime suggester/prompt.
				const inputType = this.inputFieldType(parsed);
				const req: FieldRequirement = {
					id: requirementId,
					label: displayLabel,
					type: hasOptions ? this.optionFieldType(parsed) : inputType,
					optional: parsed.optional,
				};
				if (hasOptions) this.applyOptionFields(req, parsed);
				else if (inputType === "dropdown") req.options = ["true", "false"];
				else if (inputType === "number") req.numericConfig = parsed.numericConfig;
				else if (inputType === "slider") {
					req.numericConfig = parsed.numericConfig;
					req.sliderConfig = parsed.sliderConfig;
				}
				if (defaultValue) req.defaultValue = defaultValue;
				this.markScanContext(req);
				this.requirements.set(requirementId, req);
			} else {
				const existing = this.requirements.get(requirementId)!;
				this.markScanContext(existing);
				// A later occurrence with an option list upgrades a requirement
				// first recorded option-less, so the form renders the picker
				// regardless of order.
				if (hasOptions && !this.hasOptionList(existing)) {
					existing.type = this.optionFieldType(parsed);
					existing.label = displayLabel;
					this.applyOptionFields(existing, parsed);
					// A non-custom dropdown stores raw option values, so a default
					// that is not one would snap to the first option: clear it.
					// Unquote first, since the default was recorded option-less.
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

	/**
	 * A named VALUE finds an earlier answer by its exact name, or else by the
	 * one name that matches case-insensitively (two are ambiguous at run time).
	 */
	private findRequirementIgnoringCase(
		key: string,
		type: FieldType,
	): FieldRequirement | undefined {
		const id = uniqueKeyIgnoringCase(this.requirements.keys(), key);
		const requirement = id === undefined ? undefined : this.requirements.get(id);
		return requirement?.type === type ? requirement : undefined;
	}

	private inputFieldType(context?: Pick<PromptContext, "inputTypeOverride">): FieldType {
		switch (context?.inputTypeOverride) {
			case "checkbox": return "dropdown";
			case "number": return "number";
			case "slider": return "slider";
			case "multiline": return "textarea";
			default: return this.plugin.settings.inputPrompt === "multi-line" ? "textarea" : "text";
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
		// |multi without |custom still needs a suggesterConfig.
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
	 * Textual VDATE scan. The inherited prompt hook fires once per variable, so
	 * per-occurrence |optional flags need this to apply the AND rule.
	 */
	private scanDateTokens(input: string) {
		const re = new RegExp(DATE_VARIABLE_REGEX.source, "gi");
		let match: RegExpExecArray | null;
		while ((match = re.exec(input)) !== null) {
			const variableName = match[1]?.trim();
			if (!variableName) continue;
			this.notePosition(variableName, match.index);

			const { defaultValue, optional, withTime, label } = parseVDateOptions(
				match[3],
			);
			const dateFormat =
				match[2]?.trim() || defaultDateVariableFormat(withTime);

			// A VDATE finds an earlier answer by its exact name at run time.
			const existing = this.requirements.get(variableName);
			if (!existing) {
				this.requirements.set(variableName, {
					id: variableName,
					label: label ?? variableName,
					type: "date",
					defaultValue,
					dateFormat,
					withTime,
					optional,
					source: "collected",
				});
			} else {
				// A plain {{VALUE:<name>}} seen first, say in the file name, is
				// answered with text that this VDATE then parses: ask for a date.
				if (
					(existing.type === "text" || existing.type === "textarea") &&
					!this.hasOptionList(existing)
				) {
					existing.type = "date";
					existing.dateFormat = dateFormat;
					existing.withTime = withTime;
					if (label) existing.label = label;
				}
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

	protected async promptForValue(header?: string): Promise<string> {
		const key = "value";
		if (!this.requirements.has(key)) {
			// A |type: on the token wins over One entry per line.
			const type = this.valueTakesLines && !this.valuePromptContext?.inputTypeOverride
				? "textarea"
				: this.inputFieldType(this.valuePromptContext);
			const derived = describeValuePrompt(
				this.scanningScope,
				this.scanningSoleValue,
			);
			this.requirements.set(key, {
				id: key,
				label:
					this.valuePromptContext?.label ||
					derived.title ||
					header ||
					"Enter value",
				type,
				placeholder: derived.placeholder,
				defaultValue: this.valuePromptContext?.defaultValue,
				numericConfig: this.valuePromptContext?.numericConfig,
				sliderConfig: this.valuePromptContext?.sliderConfig,
				options: type === "dropdown" ? ["true", "false"] : undefined,
				source: "collected",
				optional: this.valuePromptContext?.optional,
			});
		}
		// Fires once per collector, but path strings are scanned before content
		// strings, so a dual-use VALUE is marked in path context.
		this.markScanContext(this.requirements.get(key)!);
		return "";
	}

	protected async promptForVariable(
		variableName?: string,
		context?: PromptContext,
	): Promise<string> {
		if (!variableName) return "";
		const key = context?.variableKey ?? variableName;

		// scanDateTokens records VDATE requirements from every occurrence.
		if (context?.type === "VDATE") {
			return context.defaultValue ?? encodeDateToken("1970-01-01T00:00:00.000Z");
		}

		if (!this.requirements.has(key)) {
			// Split like parseValueToken, honoring quoted commas, so this cannot
			// disagree with the runtime split.
			const optionValues = splitQuotedCommaList(variableName)
				.map((s) => s.trim())
				.filter(Boolean);
			const hasOptions = optionValues.length > 1;
			const type = hasOptions ? "dropdown" : this.inputFieldType(context);
			const req: FieldRequirement = {
				id: key,
				label: context?.label ?? variableName,
				type,
				numericConfig: context?.numericConfig,
				sliderConfig: context?.sliderConfig,
				source: "collected",
			};
			if (hasOptions) {
				req.options = optionValues;
			} else if (type === "dropdown") {
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
		// {{MVALUE}} is legal in path strings too, so mark it like the VALUE hooks.
		this.markScanContext(this.requirements.get(key)!);
		return "";
	}

	protected async suggestForField(variableName: string): Promise<string> {
		// Keyed with the runtime "FIELD:" prefix so one-page answers land where
		// replaceFieldVarInString looks them up.
		const parsed = FieldSuggestionParser.parse(variableName);
		const key = this.fieldRequirementId(variableName);
		// A named FIELD asks before a {{VALUE:<name>}} of the same text, so its
		// picker replaces the text input that VALUE was recorded with.
		const existing = this.requirements.get(key);
		const replacesTextInput = existing !== undefined &&
			(existing.type === "text" || existing.type === "textarea") &&
			!this.hasOptionList(existing);
		if (!existing || replacesTextInput) {
			const requirement: FieldRequirement = {
				id: key,
				label: parsed.label ?? (parsed.fieldName || variableName),
				type: "field-suggest",
				source: "collected",
				runtimeOnly: parsed.multiSelect,
				fieldSpecifier: variableName,
			};
			// Single-select |default-from:active prefills the form with the active
			// note's value. Multi FIELD is runtime-only and preselects in the
			// MultiSuggester instead.
			if (!parsed.multiSelect && parsed.filters.defaultFrom === "active") {
				const resolved = resolveActiveNoteFieldDefault(
					this.app,
					this.choiceExecutor?.triggerContext?.activeFile ?? null,
					parsed.fieldName,
				);
				// Fall back to the literal |default: when the active value resolves
				// nothing, as the runtime path does.
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

	/** A FIELD's answer is under the run variable its `|name:` names, or else its own FIELD: key. */
	private fieldRequirementId(fieldSpecifier: string): string {
		return (
			FieldSuggestionParser.parse(fieldSpecifier).name ??
			`${FIELD_VARIABLE_PREFIX}${fieldSpecifier}`
		);
	}

	/**
	 * Records {{FILE:...}} requirements from every occurrence so they show up
	 * front. The inherited prompt hook fires once per key and would not merge
	 * per-occurrence flags.
	 */
	private scanFileTokens(input: string) {
		const re = new RegExp(FILE_REGEX.source, "gi");
		let match: RegExpExecArray | null;
		while ((match = re.exec(input)) !== null) {
			const parsed = parseFileToken(match[1] ?? "");
			if (!parsed) continue;
			this.notePosition(parsed.variableKey, match.index);
			this.recordFileRequirement(parsed);
		}
	}

	private recordFileRequirement(parsed: ParsedFileToken): void {
		const key = parsed.variableKey;
		const existing = this.requirements.get(key);
		if (existing) {
			// Same AND rule as VALUE/VDATE.
			existing.optional = (existing.optional ?? false) && parsed.optional;
			// Shared |name: occurrences collapse into one typed FILE picker. Merge
			// capabilities order-independently so any |custom / |multi occurrence
			// upgrades the shared field without changing its stable path values.
			existing.type = "file-picker";
			existing.suggesterConfig = {
				allowCustomInput:
					(existing.suggesterConfig?.allowCustomInput ?? false) ||
					parsed.allowCustomInput,
				caseSensitive: false,
				multiSelect:
					(existing.suggesterConfig?.multiSelect ?? false) ||
					parsed.multiSelect,
			};
			return;
		}

		// Options are the folder's files encoded as `@file:<path>` (display =
		// basenames) so the chosen value round-trips to the runtime formatter,
		// which decodes it back to the file.
		const files = getFileTokenFiles(this.app, parsed);
		const options = files.map((file) => `${FILE_PICK_PREFIX}${file.path}`);
		const infos = buildFileDisplayInfos(
			files,
			(file) => this.app.metadataCache.getFileCache(file),
		);
		const displayOptions = infos.map((info) => info.label);
		// Allow a literal value when the folder has no files to pick.
		const allowCustomInput = parsed.allowCustomInput || options.length === 0;
		// Disambiguate same-folder tokens that differ only by type or mode (e.g. an
		// image and a PDF link from one folder) when no explicit |label.
		const qualifiers = [...parsed.types];
		if (parsed.mode !== "name") qualifiers.push(parsed.mode);
		const autoLabel = qualifiers.length
			? `File from ${parsed.folderPath} (${qualifiers.join(", ")})`
			: `File from ${parsed.folderPath}`;
		this.requirements.set(key, {
			id: key,
			label: parsed.label ?? autoLabel,
			type: "file-picker",
			source: "collected",
			options,
			displayOptions,
			optionAliases: infos.map((info) => info.aliases),
			optional: parsed.optional,
			suggesterConfig: {
				allowCustomInput,
				caseSensitive: false,
				multiSelect: parsed.multiSelect,
			},
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
		// scanVariableTokens already records anonymous option lists.
		return "";
	}

	protected getVariableValue(variableName: string): string {
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
		return false;
	}
}
