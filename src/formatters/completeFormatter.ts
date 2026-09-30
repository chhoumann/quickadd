import { stripCursorMarkers } from "./helpers/capturePlacement";
import { protectUserText, restoreUserText } from "./helpers/userText";
import { promptForVariable, suggestForValue, suggestForValueMulti, type PromptRuntime } from "./helpers/valuePrompts";
import { suggestForField, suggestForFile } from "./helpers/vaultPrompts";
import { expandGlobalVariables } from "./helpers/globalVariables";
import { findNextInlineScript, inlineScriptRescanFrom } from "./helpers/inlineScriptSpans";
import type { App, TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { RunClocks } from "../types/dateOrigin";
import { DATE_VARIABLE_REGEX, TITLE_REGEX } from "../constants";
import { findDateVariableFormat } from "./helpers/dateTokens";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import InputPrompt from "../gui/InputPrompt";
import { MathModal } from "../gui/MathModal";
import type QuickAdd from "../main";
import type { IDateParser } from "../parsers/IDateParser";
import type { InputPromptOptions } from "../types/inputPrompt";
import { NLDParser } from "../parsers/NLDParser";
import { type FieldFilter } from "../utils/FieldSuggestionParser";
import { type ParsedFileToken } from "../utils/fileSyntax";
import { normalizeNumericValue } from "../utils/valueSyntax";
import { collectFieldValuesRaw, generateFieldCacheKey } from "../utils/FieldValueCollector";
import { getActiveMarkdownEditorView } from "../utils/activeMarkdownEditor";
import { Formatter, type PromptContext } from "./formatter";
import {
	buildPromptContextLine,
	describeValuePrompt,
	isPathScope,
	scopeShowsDestination,
	type PromptScopeKind,
} from "./promptScope";
import {
	buildSectionSubpath,
	extractHeadingsFromLines,
	sanitizeHeadingForSubpath,
} from "./helpers/sectionLink";
import { UserCancelError } from "../errors/UserCancelError";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { isCancellationError } from "../utils/errorUtils";

export class CompleteFormatter extends Formatter {
	/**
	 * True only while formatFileContent's format() pass runs. Value prompts
	 * opened during that window accept clipboard-image paste; prompts opened
	 * from path passes (file name, folder, template path, location targets)
	 * never do — an embed link in a path would corrupt it (issue #1484).
	 */
	private contentValuePromptsAcceptImagePaste = false;
	private preserveTemplateCursorMarkers = false;
	/** See {@link withUserTextProtected}. */
	private keepUserTextProtected = false;

	constructor(
		protected app: App,
		private plugin: QuickAdd,
		protected choiceExecutor?: IChoiceExecutor,
		dateParser?: IDateParser,
	) {
		super(app);
		this.dateParser = dateParser || NLDParser;
		if (choiceExecutor) {
			this.variables = choiceExecutor?.variables;
		}
	}

	protected userText(text: string): string {
		return protectUserText(text);
	}

	/**
	 * Content formatted inside `work` keeps answers and other user text marked,
	 * for a caller that runs Templater and finds `{{CURSOR}}` markers before it
	 * calls restoreUserText. Every other result is restored before it is returned.
	 */
	async withUserTextProtected<T>(work: () => Promise<T>): Promise<T> {
		const previous = this.keepUserTextProtected;
		this.keepUserTextProtected = true;
		try {
			return await work();
		} finally {
			this.keepUserTextProtected = previous;
		}
	}

	protected runClocks(): RunClocks | undefined {
		return this.choiceExecutor?.clocks ?? this.clocks;
	}

	protected async format(input: string): Promise<string> {
		let output: string = input;

		output = await this.replaceInlineJavascriptInString(output);
		output = await this.replaceMacrosInString(output);
		const outerIncludingText = this.includingText;
		// Globals expand after the includes render, but a VDATE inside one still counts.
		this.includingText = await this.replaceGlobalVarInString(output);
		try {
			output = await this.replaceTemplateInString(output);
		} finally {
			this.includingText = outerIncludingText;
		}
		// Expand global variables early so injected snippets can be further formatted
		output = await this.replaceGlobalVarInString(output);
		return this.formatScalarTokens(output);
	}

	protected async formatScalarTokens(input: string): Promise<string> {
		let output = input;
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
		// PROPERTY last so seeded property text is never re-scanned as format
		// tokens (#1748). Scripts/macros/globals above can still inject the token.
		if (!this.defersPropertyExpansion()) {
			output = this.replacePropertyInString(output);
		}

		return this.promptScope === "captureText" ||
			(this.promptScope === "noteBody" && this.preserveTemplateCursorMarkers)
			? output : stripCursorMarkers(output);
	}

	protected async replaceGlobalVarInString(input: string): Promise<string> {
		return expandGlobalVariables(input, this.plugin?.settings?.globalVariables);
	}

	/**
	 * Formats a file path. `scope` says WHAT the path is, so a `{{VALUE}}` inside
	 * it can name itself at prompt time (issue #1546): the same entry point
	 * produces Template note titles, Capture targets and a macro's file-to-open.
	 */
	async formatFileName(
		input: string,
		scope: PromptScopeKind = "generic",
	): Promise<string> {
		// Check for {{title}} usage in filename which would cause infinite recursion
		if (TITLE_REGEX.test(input)) {
			throw new Error(
				"{{title}} cannot be used in file names as it would create a circular dependency. The title is derived from the filename itself.",
			);
		}

		let output = await this.withPromptScope(scope, input, () =>
			this.format(input),
		);
		// Expanded values can introduce {{title}}, so repeat the circular-title check after formatting.
		if (TITLE_REGEX.test(output)) {
			throw new Error(
				"{{title}} cannot be used in file names as it would create a circular dependency. The title is derived from the filename itself.",
			);
		}
		// Resolve contextual tokens in one pass; missing active-folder paths must abort rather than retarget writes.
		output = this.replaceCurrentFileTokensInString(output, {
			fileName: true,
			folder: true,
			activeFolder: "path",
		});
		return restoreUserText(output);
	}

	/**
	 * When true, {@link format} leaves `{{PROPERTY}}` for the caller to expand
	 * after later passes (used by {@link formatPropertyValue} so seeded text is
	 * not re-scanned by current-file tokens).
	 */
	private skipPropertyExpansion = false;

	/**
	 * An included `{{TEMPLATE:}}` renders in its own formatter, but its text lands
	 * wherever its includer's text does. So it answers every question about that
	 * destination (list items, `{{PROPERTY}}`, selection as value, clipboard,
	 * links) the way its includer does. These are the hooks
	 * CaptureChoiceFormatter overrides.
	 */
	private get includer(): CompleteFormatter | undefined {
		return this.templateInclusion?.includer;
	}

	/** This formatter's text while its `{{TEMPLATE:}}` includes render. */
	private includingText: string | null = null;

	/**
	 * Includes render before the including text's `{{VDATE}}`s. So when an
	 * include's `{{VALUE:<name>}}` reuses one, resolve that VDATE now: it asks
	 * the date prompt (or takes the prefilled answer) and records its format, as
	 * a reuse in the including text itself would.
	 */
	protected override async resolveIncludingTextDate(variableName: string): Promise<void> {
		if (!this.includer || findDateVariableFormat(this.variables, variableName) !== undefined) return;
		for (let includer: CompleteFormatter | undefined = this.includer; includer; includer = includer.includer) {
			// Every VDATE a named VALUE could match, in order, as the including
			// text's own VDATE phase would resolve them before its VALUEs.
			const sameName = [...(includer.includingText ?? "").matchAll(new RegExp(DATE_VARIABLE_REGEX.source, "gi"))]
				.filter((match) => match[1]?.trim().toLowerCase() === variableName.toLowerCase());
			if (sameName.length > 0) {
				await includer.replaceDateVariableInString(sameName.map((match) => match[0]).join(""));
				return;
			}
		}
	}

	private defersPropertyExpansion(): boolean {
		return this.includer?.defersPropertyExpansion() ?? this.skipPropertyExpansion;
	}

	protected writesListPicksAsLines(): boolean {
		return this.includer?.writesListPicksAsLines() ?? super.writesListPicksAsLines();
	}

	async formatPropertyName(input: string): Promise<string> {
		return await this.withPromptScope("propertyName", input, async () =>
			restoreUserText(this.replaceCurrentFileTokensInString(await this.format(input), {
				links: true, fileName: true, folder: true, activeFolder: "content", title: true,
			})),
		);
	}

	/** `listItems`: the value lands in a list, so each list pick becomes its own line (item). */
	async formatPropertyValue(input: string, options: { listItems?: boolean } = {}): Promise<unknown> {
		const value = await this.preserveSingleTokenValue(input, () =>
			this.withPromptScope("propertyValue", input, async () => {
				// Author tokens (VALUE/DATE/…) and current-file tokens run first.
				// PROPERTY expands last so the seeded snapshot is inserted as
				// literal text and cannot be re-scanned (#1748 CodeRabbit).
				this.skipPropertyExpansion = true;
				this.listPicksAsLines = options.listItems ?? false;
				let output: string;
				try {
					output = await this.format(input);
				} finally {
					this.skipPropertyExpansion = false;
					this.listPicksAsLines = false;
				}
				output = this.replaceCurrentFileTokensInString(output, {
					links: true, fileName: true, folder: true, activeFolder: "content", title: true,
				});
				return this.replacePropertyInString(output);
			}),
		);
		// A value that is not the formatted text is the token's own value, kept as data.
		return typeof value === "string" ? restoreUserText(stripCursorMarkers(value)) : value;
	}

	async formatTemplateContent(input: string): Promise<string> {
		return this.formatContentWithCursorMarkers(input, true);
	}

	async formatFileContent(input: string): Promise<string> {
		return this.formatContentWithCursorMarkers(input, false);
	}

	private async formatContentWithCursorMarkers(input: string, preserveMarkers: boolean): Promise<string> {
		let output: string = input;
		const previousCursorMarkers = this.preserveTemplateCursorMarkers;
		this.preserveTemplateCursorMarkers = preserveMarkers;

		// Enable image paste only during content formatting, restoring the flag across nested or failed passes.
		const previousImagePaste = this.contentValuePromptsAcceptImagePaste;
		// ...unless the declared scope says this content is destined for a PATH,
		// which happens when a {{TEMPLATE:}} include is spliced into a file name
		// or folder and rendered through its own formatter.
		this.contentValuePromptsAcceptImagePaste = !isPathScope(this.promptScope);
		try {
			output = await this.format(output);
		} finally {
			this.contentValuePromptsAcceptImagePaste = previousImagePaste;
			this.preserveTemplateCursorMarkers = previousCursorMarkers;
		}
		// A single contextual pass preserves token-looking replacement text. Content may strip optional missing tokens.
		output = this.replaceCurrentFileTokensInString(output, {
			links: true,
			fileName: true,
			folder: true,
			activeFolder: "content",
			title: true,
		});

		// An included template's text is restored by the formatter that includes it.
		return this.keepUserTextProtected || this.includer ? output : restoreUserText(output);
	}

	async formatFolderPath(folderName: string): Promise<string> {
		// Check for {{title}} usage in folder path which would cause issues
		if (TITLE_REGEX.test(folderName)) {
			throw new Error(
				"{{title}} cannot be used in folder paths as it would create a circular dependency. The title is derived from the filename itself.",
			);
		}

		const formatted = await this.withPromptScope("folder", folderName, () =>
			this.format(folderName),
		);
		// Repeat the circular-title guard after expanding globals and user values.
		if (TITLE_REGEX.test(formatted)) {
			throw new Error(
				"{{title}} cannot be used in folder paths as it would create a circular dependency. The title is derived from the filename itself.",
			);
		}

		// The target folder is still unknown here and resolves empty; the active folder resolves or aborts in path mode.
		const resolved = this.replaceCurrentFileTokensInString(formatted, {
			folder: true,
			activeFolder: "path",
		});
		// Empty folder tokens can leave leading slashes; remove them to keep the remaining path vault-relative.
		return restoreUserText(resolved).replace(/^\/+/, "");
	}

	/** Resolve source paths once, without executable tokens or inclusions.
 * The resolved path must supply both the source content and the target extension. */
	async formatTemplateFilePath(input: string): Promise<string> {
		if (TITLE_REGEX.test(input)) {
			throw new Error(
				"{{title}} cannot be used in a template path — the title is derived from the created file, not the source template.",
			);
		}

		let output = input;
		// Expand globals first so an injected snippet's path-safe tokens resolve.
		output = await this.replaceGlobalVarInString(output);

		// Check global-injected title tokens before user substitution, allowing literal title text in user answers.
		if (TITLE_REGEX.test(output)) {
			throw new Error(
				"{{title}} cannot be used in a template path — the title is derived from the created file, not the source template.",
			);
		}

		// Use the shared scalar pass with the original input declaring the source-path prompt scope.
		output = await this.withPromptScope("templatePath", input, () =>
			this.formatScalarTokens(output),
		);

		// Trim so the suffix the engine reads for the extension matches the path
		// getTemplateFile ultimately resolves (which trims) — otherwise a token
		// that leaves trailing whitespace could split the two.
		return restoreUserText(output).trim();
	}

	/**
	 * Formats small inline target strings used for location matching, e.g.,
	 * the line-target capture selectors. This intentionally does not run Templater,
	 * but applies the core QuickAdd format pipeline plus link/title expansion
	 * so selectors can reference {{linkcurrent}} and {{title}} consistently.
	 */
	protected async formatLocationString(input: string): Promise<string> {
		let output = await this.withPromptScope("lineTarget", input, () =>
			this.format(input),
		);
		// Keep folder tokens literal in location selectors: an empty folder would match the first line.
		output = this.replaceCurrentFileTokensInString(output, {
			links: true,
			fileName: true,
			title: true,
		});
		return restoreUserText(output);
	}

	// CaptureChoiceFormatter overrides this with the capture destination.
	protected getLinkSourcePath(): string | null {
		return this.includer?.getLinkSourcePath() ?? null;
	}

	protected getCurrentFileLink(): string | null {
		if (this.includer) return this.includer.getCurrentFileLink();
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		return this.app.fileManager.generateMarkdownLink(currentFile, "");
	}

	protected getCurrentFileName(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		return currentFile.basename;
	}

	/** Active folder path without edge slashes; null means unavailable, empty means vault root. */
	protected getCurrentFolderPath(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		const parentPath = currentFile.parent?.path ?? "";
		return parentPath === "/" ? "" : parentPath;
	}

	/** Resolve the cursor heading link only when present, honoring required/optional behavior. */
	protected getCurrentFileLinkToSection(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		const sourcePath = this.getLinkSourcePath() ?? "";
		// Never let section resolution throw out of a capture/template run — fall
		// back to a whole-file link if anything goes wrong.
		let subpath: string | null = null;
		try {
			subpath = this.getActiveHeadingSubpath(currentFile);
		} catch {
			subpath = null;
		}

		return subpath
			? this.app.fileManager.generateMarkdownLink(
					currentFile,
					sourcePath,
					subpath,
				)
			: this.app.fileManager.generateMarkdownLink(currentFile, sourcePath);
	}

	/** Build a heading subpath, including parents where needed to disambiguate duplicate headings. */
	private getActiveHeadingSubpath(file: TFile): string | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		// Only trust the cursor when the active markdown view is THIS file and is
		// in an editing mode (reading mode has no meaningful cursor line).
		if (!view || view.file?.path !== file.path) return null;
		if (view.getMode() === "preview") return null;

		const editor = view.editor;
		const cursor = editor?.getCursor();
		if (!editor || !cursor) return null;

		// Split on \r?\n so CRLF buffers don't leave a trailing \r that breaks the
		// heading parse (and so line indices match the editor's cursor line).
		const text = editor.getValue();
		const parsed = extractHeadingsFromLines(text.split(/\r?\n/));

		// Obsidian resolves a `#heading` link against its metadata cache, so when
		// the buffer is saved (view.data is the last loaded/saved text) use those
		// headings: they skip `#` lines inside comments, HTML, and math blocks.
		// Unsaved text isn't in the cache yet, so keep the live parse instead.
		// view.data keeps a CRLF file's line endings; the editor text is LF-only.
		const saved = view.data.replace(/\r\n/g, "\n") === text;
		const cache = saved ? this.app.metadataCache.getFileCache(file) : null;
		const cached = (cache?.headings ?? []).map((h) => ({
			heading: h.heading,
			level: h.level,
			line: h.position.start.line,
		}));
		// The cache catches up a few ms after a save (longer for big notes), so
		// only trust it while every cached heading is still at its line, with its
		// level, in the live parse. A renamed or removed heading would otherwise
		// be linked.
		const key = (h: { heading: string; level: number }) =>
			`${h.level}:${sanitizeHeadingForSubpath(h.heading)}`;
		const parsedByLine = new Map(parsed.map((p) => [p.line, key(p)]));
		const fresh =
			cache && cached.every((c) => parsedByLine.get(c.line) === key(c));

		return buildSectionSubpath(fresh ? cached : parsed, cursor.line);
	}

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	protected shouldUseSelectionForValue(): boolean {
		return this.includer?.shouldUseSelectionForValue() ?? true;
	}

	protected async getSelectedTextForValue(): Promise<string> {
		return this.includer
			? await this.includer.getSelectedTextForValue()
			: await this.getSelectedText();
	}

	/** Allow remote prompts before applying headless rejection; every token prompt calls this guard. */
	private assertInteractivePrompt(what: string): void {
		if (this.choiceExecutor?.interactive === false) {
			throw new ChoiceAbortError(
				`This run is non-interactive but a value for ${what} was not provided up front. ` +
					`Pass it (e.g. a value- flag) or re-run with the ui flag.`,
			);
		}
	}

	/** Anonymous VALUE prompt metadata follows the declared scope, including optional image paste in content. */
	private describeAnonymousValuePrompt(): {
		title: string;
		placeholder?: string;
		contextLine?: string;
		contextLineFull?: string;
	} {
		const derived = describeValuePrompt(
			this.promptScope,
			this.promptScopeSoleValue,
		);
		const title =
			this.valuePromptContext?.label ??
			derived.title ??
			(this.promptRunContext?.choiceName?.trim() || "Enter value");
		const showDestination = scopeShowsDestination(this.promptScope);
		return {
			title,
			placeholder: derived.placeholder,
			contextLine: buildPromptContextLine(this.promptRunContext, title, {
				showDestination,
			}),
			contextLineFull: buildPromptContextLine(this.promptRunContext, title, {
				elide: false,
				showDestination,
			}),
		};
	}

	protected async promptForValue(header?: string): Promise<string> {
		if (this.value === undefined) {
			if (this.shouldUseSelectionForValue()) {
				const selectedText: string = await this.getSelectedTextForValue();
				if (selectedText) {
					const normalizedSelection =
						this.normalizeSelectedTextForPrompt(selectedText);
					if (normalizedSelection !== undefined) {
						this.value = normalizedSelection;
						return this.value;
					}
				}
			}
			// No selection resolved the value; any path below opens a prompt.
			this.assertInteractivePrompt("{{VALUE}}");
			// Anonymous {{VALUE|type:checkbox}} gets the same forced true/false
			// picker as the named form (resolved before the InputPrompt factory).
			if (this.valuePromptContext?.inputTypeOverride === "checkbox") {
				// Route to a remote interactive session (Raycast) when one is driving,
				// mirroring promptForVariable's named {{VALUE:x|type:checkbox}} path.
				const checkboxProvider = this.choiceExecutor?.promptProvider;
				if (checkboxProvider) {
					this.value = String(
						await checkboxProvider.suggester(
							["true", "false"],
							["true", "false"],
							this.describeAnonymousValuePrompt().title,
							false,
						),
					);
					return this.value;
				}
				try {
					this.value = await GenericSuggester.Suggest(
						this.app,
						["true", "false"],
						["true", "false"],
						this.describeAnonymousValuePrompt().title,
						undefined,
						this.valuePromptContext.optional
							? { skippable: true }
							: undefined,
					);
					return this.value;
				} catch (error) {
					if (isCancellationError(error)) {
						throw new UserCancelError("Input cancelled by user");
					}
					throw error;
				}
			}
			const prompt = this.describeAnonymousValuePrompt();
			// Remote prompts lack a context-line channel, so include context in their header.
			const valueProvider = this.choiceExecutor?.promptProvider;
			if (valueProvider) {
				this.value = await valueProvider.inputPrompt(
					prompt.contextLine
						? `${prompt.title} (${prompt.contextLine})`
						: prompt.title,
					this.valuePromptContext?.placeholder ?? prompt.placeholder,
					this.valuePromptContext?.defaultValue,
				);
				return this.value;
			}
			try {
				const linkSourcePath = this.getLinkSourcePath();
				const promptFactory = new InputPrompt().factory(
					this.valuePromptContext?.inputTypeOverride,
				);
				const defaultValue = this.valuePromptContext?.defaultValue;
				const promptOptions = this.buildInputPromptOptions(
					this.valuePromptContext,
					prompt.contextLine,
					prompt.contextLineFull,
				);
				const placeholder =
					this.valuePromptContext?.placeholder ?? prompt.placeholder;
				if (linkSourcePath) {
					this.value = await promptFactory.PromptWithContext(
						this.app,
						prompt.title,
						placeholder,
						defaultValue,
						linkSourcePath,
						undefined,
						promptOptions,
					);
				} else {
					this.value = await promptFactory.Prompt(
						this.app,
						prompt.title,
						placeholder,
						defaultValue,
						undefined,
						promptOptions,
					);
				}
			} catch (error) {
				if (isCancellationError(error)) {
					throw new UserCancelError("Input cancelled by user");
				}
				throw error;
			}
		}

		return this.value;
	}

	private normalizeSelectedTextForPrompt(
		selectedText: string,
	): string | undefined {
		const context = this.valuePromptContext;

		// Checkbox selections must be boolean text; other selections fall through to the true/false picker.
		if (context?.inputTypeOverride === "checkbox") {
			const boolText = selectedText.trim().toLowerCase();
			return boolText === "true" || boolText === "false"
				? boolText
				: undefined;
		}

		if (
			context?.inputTypeOverride !== "number" &&
			context?.inputTypeOverride !== "slider"
		) {
			return selectedText;
		}

		const numericConfig = context.sliderConfig ?? context.numericConfig;
		const normalized = normalizeNumericValue(selectedText, numericConfig);
		return normalized === "" ? undefined : normalized;
	}

	private buildInputPromptOptions(
		context: PromptContext | undefined,
		contextLine?: string,
		contextLineFull?: string,
	): InputPromptOptions {
		// Only free-text content prompts accept images; numeric and path prompts never do.
		const imagePaste =
			this.contentValuePromptsAcceptImagePaste &&
			context?.inputTypeOverride !== "number" &&
			context?.inputTypeOverride !== "slider"
				? { sourcePath: this.getLinkSourcePath() ?? "" }
				: undefined;
		const draftScopeId = this.promptRunContext?.draftScopeId;
		return {
			optional: context?.optional,
			numeric: context?.numericConfig,
			slider: context?.sliderConfig,
			imagePaste,
			contextLine,
			contextLineFull,
			draftScopeId,
			// Choice-run prompts open over the note being worked on, exactly
			// the context peek exists for. Number/slider prompts ignore it.
			allowPeek: true,
		};
	}
	private promptRuntime(): PromptRuntime {
		return {
			app: this.app,
			executor: this.choiceExecutor,
			scope: this.promptScope,
			runContext: this.promptRunContext,
			assertInteractivePrompt: (what) => this.assertInteractivePrompt(what),
			buildInputPromptOptions: (context, line, full) => this.buildInputPromptOptions(context, line, full),
		};
	}

	protected async promptForVariable(header?: string,
	context?: PromptContext): Promise<string> {
		return promptForVariable(this.promptRuntime(), header, context);
	}

	protected async promptForMathValue(): Promise<string> {
		const provider = this.choiceExecutor?.promptProvider;
		if (provider) {
			return await provider.inputPrompt("Enter a math expression");
		}
		// The token is {{MVALUE}} (MATH_VALUE_REGEX). "a {{MATH}} expression"
		// named a token QuickAdd has never had, in the one message whose whole
		// job is to tell a non-interactive caller which flag to pass (#1587).
		this.assertInteractivePrompt("a {{MVALUE}} math expression");
		try {
			return await MathModal.Prompt();
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}
	}
	protected async suggestForValue(suggestedValues: string[],
	allowCustomInput = false,
	context?: {
			placeholder?: string;
			variableKey?: string;
			displayValues?: string[];
			optional?: boolean;
		}): Promise<string> {
		return suggestForValue(this.promptRuntime(), suggestedValues, allowCustomInput, context);
	}
	protected async suggestForValueMulti(suggestedValues: string[],
	allowCustomInput = false,
	context?: {
			placeholder?: string;
			variableKey?: string;
			displayValues?: string[];
			optional?: boolean;
		}): Promise<string[]> {
		return suggestForValueMulti(this.promptRuntime(), suggestedValues, allowCustomInput, context);
	}
	protected async suggestForField(fieldInput: string): Promise<string | string[]> {
		this.assertInteractivePrompt(`{{FIELD:${fieldInput}}}`);
		return suggestForField({ app: this.app, executor: this.choiceExecutor, getSourcePath: () => this.getLinkSourcePath() }, fieldInput);
	}

	private generateCacheKey(filters: FieldFilter): string {
		return generateFieldCacheKey(filters);
	}
	protected async suggestForFile(parsed: ParsedFileToken): Promise<string | string[]> {
		this.assertInteractivePrompt(
			`{{FILE}} (pick a file from ${parsed.folderPath})`,
		);
		return suggestForFile({ app: this.app, executor: this.choiceExecutor, getSourcePath: () => this.getLinkSourcePath() }, parsed);
	}

	protected async getMacroValue(
		macroName: string,
		context?: { label?: string },
	): Promise<string> {
		// Imported lazily: a static import would re-create the
		// completeFormatter ⇄ engine circular dependency (#1249).
		const { SingleMacroEngine } = await import(
			"../engine/SingleMacroEngine"
		);
		const macroEngine = new SingleMacroEngine(
			this.app,
			this.plugin,
			this.plugin.settings.choices,
			//@ts-ignore
			this.choiceExecutor,
			this.variables,
		);
		const macroOutput =
			(await macroEngine.runAndGetOutput(macroName, context)) ?? "";

		// Copy variables from macro execution
		macroEngine.getVariables().forEach((value, key) => {
			this.variables.set(key, value);
		});

		return macroOutput;
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		// Imported lazily to avoid the completeFormatter ⇄ engine cycle (#1249).
		const { SingleTemplateEngine } = await import(
			"../engine/SingleTemplateEngine"
		);
		this.templateInclusion ??= { visited: new Set<string>(), depth: 0 };
		const childInclusion = {
			visited: this.templateInclusion.visited,
			depth: this.templateInclusion.depth + 1,
			includer: this,
		};
		const childEngine = new SingleTemplateEngine(
			this.app,
			this.plugin,
			templatePath,
			this.choiceExecutor,
			childInclusion,
		);
		// Propagate the target folder so {{FOLDER}} resolves inside included
		// templates ({{TEMPLATE:...}}), which render via this child engine's own
		// formatter.
		childEngine.setTargetFolderPath(this.targetFolderPath);
		if (this.preserveTemplateCursorMarkers && this.promptScope === "noteBody") {
			childEngine.setPreserveCursorMarkers(true);
		}
		// An include spliced into a path is part of that path: keep the caller's
		// scope so its prompts do not claim to be asking for note content.
		if (this.promptScope !== "generic") {
			childEngine.setPromptScope(this.promptScope);
		}
		// Propagate run context but give included templates distinct draft keys to avoid reusing parent answers.
		if (this.promptRunContext) {
			childEngine.setPromptRunContext({
				...this.promptRunContext,
				draftScopeId: `${this.promptRunContext.draftScopeId ?? ""}#${templatePath}`,
			});
		}
		const content = await childEngine.run();
		this.mergeTemplatePropertyVars(
			childEngine.getAndClearTemplatePropertyVars(),
		);
		return content;
	}

	protected async getSelectedText(): Promise<string> {
		const activeView = getActiveMarkdownEditorView(this.app);
		if (!activeView) return "";

		return activeView.editor.getSelection();
	}

	protected async getClipboardContent(): Promise<string> {
		if (this.includer) return this.includer.getClipboardContent();
		try {
			return await navigator.clipboard.readText();
		} catch {
			// Fallback for when clipboard access fails (permissions, security context, etc.)
			return "";
		}
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return this.plugin.settings.enableTemplatePropertyTypes;
	}

	protected async replaceInlineJavascriptInString(input: string) {
		let output: string = input;
		let fence = findNextInlineScript(output);

		while (fence) {
			const { start, end, code } = fence;
			let replacement = "";

			if (code) {
				// Imported lazily to avoid the completeFormatter ⇄ engine cycle (#1249).
				const { SingleInlineScriptEngine } = await import(
					"../engine/SingleInlineScriptEngine"
				);
				const executor = new SingleInlineScriptEngine(
					this.app,
					this.plugin,
					//@ts-ignore
					this.choiceExecutor,
					this.variables,
				);
				const outVal: unknown = await executor.runAndGetOutput(code);

				for (const key in executor.params.variables) {
					this.variables.set(key, executor.params.variables[key]);
				}

				if (typeof outVal === "string") {
					// Keep string insertion byte-for-byte compatible, including the
					// later formatter passes that may process tokens in the result.
					replacement = outVal;
				} else if (
					typeof outVal === "number" ||
					typeof outVal === "boolean" ||
					Array.isArray(outVal)
				) {
					// Reuse the same typed-value route as {{VALUE:key}}: containers in a
					// sole frontmatter position are collected for processFrontMatter,
					// arrays elsewhere join with commas, and scalars render directly.
					replacement =
						this.renderCollectedOrArrayValue({
							input: output,
							matchStart: start,
							matchEnd: end,
							rawValue: outVal,
							fallbackKey: "inlineScript",
							heuristicEnabled: this.isTemplatePropertyTypesEnabled(),
						}) ?? String(outVal);
				}
				// null/undefined and unsupported values intentionally keep the
				// legacy empty-output behavior rather than inventing serialization.
			}
			// An empty/whitespace-only fence (e.g. ```js quickadd\n```) is consumed
			// too, so the loop terminates instead of spinning forever.
			output = output.slice(0, start) + replacement + output.slice(end);
			// Scan on from the replacement, not past it: a script's output can
			// hold a fence of its own, which then runs too.
			fence = findNextInlineScript(output, inlineScriptRescanFrom(output, start));
		}

		return output;
	}

	private async collectValuesManually(
		fieldName: string,
		filters: FieldFilter,
	): Promise<Set<string>> {
		return await collectFieldValuesRaw(this.app, fieldName, filters);
	}
}
