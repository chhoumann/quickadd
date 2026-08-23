import type { App, TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import GenericInputPrompt from "src/gui/GenericInputPrompt/GenericInputPrompt";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import MultiSuggester from "src/gui/MultiSuggester/multiSuggester";
import VDateInputPrompt from "src/gui/VDateInputPrompt/VDateInputPrompt";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import {
	GLOBAL_VAR_REGEX,
	INLINE_JAVASCRIPT_REGEX,
	// Replaces six inlined copies of `/\{\{title\}\}/i` in this file. The
	// file-name PREVIEW now mirrors the same rule (#1588), so the pattern has to
	// be one shared constant rather than a seventh copy that can drift.
	TITLE_REGEX,
} from "../constants";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import InputPrompt from "../gui/InputPrompt";
import { MathModal } from "../gui/MathModal";
import type QuickAdd from "../main";
import type { IDateParser } from "../parsers/IDateParser";
import type { InputPromptOptions } from "../types/inputPrompt";
import { NLDParser } from "../parsers/NLDParser";
import {
	FieldSuggestionParser,
	type FieldFilter,
} from "../utils/FieldSuggestionParser";
import { EnhancedFieldSuggestionFileFilter } from "../utils/EnhancedFieldSuggestionFileFilter";
import {
	buildFileDisplayLabels,
	FILE_CUSTOM_PREFIX,
	FILE_PICK_PREFIX,
	type ParsedFileToken,
} from "../utils/fileSyntax";
import { normalizeNumericValue } from "../utils/valueSyntax";
import {
	collectFieldValuesProcessedDetailed,
	collectFieldValuesRaw,
	generateFieldCacheKey,
} from "../utils/FieldValueCollector";
import { FieldValueProcessor } from "../utils/FieldValueProcessor";
import { resolveActiveNoteFieldDefault } from "../utils/activeNoteFieldDefault";
import { getActiveMarkdownEditorView } from "../utils/activeMarkdownEditor";
import { log } from "../logger/logManager";
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

	protected async format(input: string): Promise<string> {
		let output: string = input;

		output = await this.replaceInlineJavascriptInString(output);
		output = await this.replaceMacrosInString(output);
		output = await this.replaceTemplateInString(output);
		// Expand global variables early so injected snippets can be further formatted
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

		return output;
	}

	protected async replaceGlobalVarInString(input: string): Promise<string> {
		let output = input;
		// Allow nested globals up to a small recursion limit
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
		// A {{title}} produced AFTER the raw-input check — by an expanded global
		// snippet ({{GLOBAL_VAR:x}} -> {{title}}) or a {{VALUE}} that resolved to
		// the literal text "{{title}}" — would otherwise survive into the file name
		// (the token pass below omits `title`, leaving it verbatim). Re-check post
		// format() so it throws the same circular-dependency error, mirroring
		// formatTemplateFilePath's post-global-expansion guard.
		if (TITLE_REGEX.test(output)) {
			throw new Error(
				"{{title}} cannot be used in file names as it would create a circular dependency. The title is derived from the filename itself.",
			);
		}
		// {{filenamecurrent}} + {{folder}} + {{foldercurrent}} in one pass (links
		// stay literal in a file name; {{title}} threw above). One pass so no token
		// re-scans another's output (#1358). activeFolder is "path": this entry
		// point produces file paths (file names AND capture targets), where a
		// missing active file must abort rather than strip to a root-level path.
		output = this.replaceCurrentFileTokensInString(output, {
			fileName: true,
			folder: true,
			activeFolder: "path",
		});
		return output;
	}

	async formatFileContent(input: string): Promise<string> {
		let output: string = input;

		// formatFileContent is the ONLY content pass: every path pass
		// (formatFileName/formatFolderPath/formatTemplateFilePath/
		// formatLocationString) calls format() directly. Image paste in value
		// prompts is therefore enabled exactly here — a pasted embed link is
		// note-body material and must never reach a file-name/path prompt
		// (issue #1484). Restored in finally so a nested/failed pass can't
		// leak the flag into a later path pass on the same formatter.
		const previousImagePaste = this.contentValuePromptsAcceptImagePaste;
		// ...unless the declared scope says this content is destined for a PATH,
		// which happens when a {{TEMPLATE:}} include is spliced into a file name
		// or folder and rendered through its own formatter.
		this.contentValuePromptsAcceptImagePaste = !isPathScope(this.promptScope);
		try {
			output = await this.format(output);
		} finally {
			this.contentValuePromptsAcceptImagePaste = previousImagePaste;
		}
		// Resolve ALL note-derived tokens ({{linkcurrent}}, {{linksection}},
		// {{filenamecurrent}}, {{folder}}, {{foldercurrent}}, {{title}}) in ONE
		// pass so no token re-scans another's generated output — fixing both the
		// cross-pass corruption and the infinite loop a token-named file/title
		// caused (#1358). activeFolder is "content": in a note body an unresolved
		// token cannot misplace data, so it follows the same required/optional
		// contract as the link/file-name tokens.
		output = this.replaceCurrentFileTokensInString(output, {
			links: true,
			fileName: true,
			folder: true,
			activeFolder: "content",
			title: true,
		});

		return output;
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
		// As in formatFileName: a {{title}} injected by a global snippet or a
		// {{VALUE}} resolving to "{{title}}" slips past the raw-input check above,
		// then the folder-only token pass would leave it literal in the path.
		// Re-check post format() so it throws the circular-dependency error.
		if (TITLE_REGEX.test(formatted)) {
			throw new Error(
				"{{title}} cannot be used in folder paths as it would create a circular dependency. The title is derived from the filename itself.",
			);
		}

		// {{FOLDER}} in a folder definition is self-referential: the target
		// folder isn't known while folders are being resolved, so it collapses
		// to an empty string rather than leaking the literal token into a path.
		// {{FOLDERCURRENT}} is NOT self-referential (the active file's folder is
		// known here) and must resolve: left verbatim it would be threaded into
		// getOrCreateFolder and CREATE a vault folder literally named
		// "{{foldercurrent}}". "path" mode: no active file aborts with a clear
		// error instead of silently collapsing the folder to the vault root.
		const resolved = this.replaceCurrentFileTokensInString(formatted, {
			folder: true,
			activeFolder: "path",
		});
		// A token that legitimately resolves to "" at the START of the path (a
		// root-level active file in "{{FOLDERCURRENT}}/Subnotes", or the {{FOLDER}}
		// collapse above) leaves a leading "/", which validateFolderPath would
		// reject as an empty first segment — falling back to the vault root
		// instead of using "Subnotes". Strip leading slashes so the folder path is
		// root-relative, matching what the capture/file-name paths do downstream.
		return resolved.replace(/^\/+/, "");
	}

	/**
	 * Resolves QuickAdd format tokens inside a *template source path*, so a
	 * choice can point at e.g. "Templates/{{value:type}} Template.md" (issue
	 * #620). This is deliberately a PATH-SAFE subset of {@link format}: it
	 * resolves value/date/time/field/file/global/selected/clipboard/random/math
	 * tokens, but never runs macros, inline JavaScript, or {{TEMPLATE:}}
	 * inclusion — a file-path lookup should not execute code or splice another
	 * template's body into a path. Note-relative tokens ({{title}}, {{FOLDER}},
	 * {{FOLDERCURRENT}}, {{FILENAMECURRENT}}, {{LINKCURRENT}}, {{LINKSECTION}})
	 * are intentionally left literal: a
	 * source template has no "current note" or target folder, so an unresolved
	 * token fails visibly instead of silently collapsing the path.
	 *
	 * Resolve once at the engine entry and thread the result downward; the
	 * resolved path then feeds BOTH the target file's extension/name and the
	 * content read, so they can never disagree (e.g. a token that expands to
	 * `.canvas`). Do not re-run this on an already-resolved path — tokens like
	 * {{date}} / {{random}} would re-evaluate to a different value.
	 */
	async formatTemplateFilePath(input: string): Promise<string> {
		if (TITLE_REGEX.test(input)) {
			throw new Error(
				"{{title}} cannot be used in a template path — the title is derived from the created file, not the source template.",
			);
		}

		let output = input;
		// Expand globals first so an injected snippet's path-safe tokens resolve.
		output = await this.replaceGlobalVarInString(output);

		// A global variable can itself expand to "{{title}}", slipping past the
		// up-front guard. Re-check here — after global expansion but BEFORE
		// user-input substitution — so a global-injected {{title}} throws the
		// clear circular-title error, without false-positiving on a user value
		// that merely contains the literal text "{{title}}".
		if (TITLE_REGEX.test(output)) {
			throw new Error(
				"{{title}} cannot be used in a template path — the title is derived from the created file, not the source template.",
			);
		}

		// Path-safe replacers, mirroring the tail of format() (completeFormatter
		// .format) MINUS macros, inline JS, and {{TEMPLATE:}} inclusion. Keep this
		// list in sync with format() when adding a path-safe token.
		// Scoped on the ORIGINAL input: prompts opened here are filling in the
		// template's source path, not the note being created.
		output = await this.withPromptScope("templatePath", input, async () => {
			let scoped = this.replaceDateInString(output);
			scoped = this.replaceTimeInString(scoped);
			scoped = await this.replaceValueInString(scoped);
			scoped = await this.replaceSelectedInString(scoped);
			scoped = await this.replaceClipboardInString(scoped);
			scoped = await this.replaceDateVariableInString(scoped);
			scoped = await this.replaceVariableInString(scoped);
			scoped = await this.replaceFieldVarInString(scoped);
			// {{FILE:...}} is path-safe (lists files + a picker, runs no code) and
			// is collected from the template path by preflight (scanTemplateSource),
			// so it MUST resolve here too or a `Templates/{{FILE:...|path}}` source
			// path would prompt up front and then fail to resolve at runtime.
			scoped = await this.replaceFileInString(scoped);
			scoped = await this.replaceMathValueInString(scoped);
			return this.replaceRandomInString(scoped);
		});

		// Trim so the suffix the engine reads for the extension matches the path
		// getTemplateFile ultimately resolves (which trims) — otherwise a token
		// that leaves trailing whitespace could split the two.
		return output.trim();
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
		// Links + {{filenamecurrent}} + {{title}} in one pass so no token re-scans
		// another's output (#1358). {{FOLDER}} and {{FOLDERCURRENT}} are
		// deliberately left literal in location selectors (insert-after/before
		// targets) — both can legitimately resolve to an empty string ("" target
		// folder / root-level active file), and an empty selector would match the
		// first line. Tokens that are nonempty-or-throw (links, file name) stay.
		output = this.replaceCurrentFileTokensInString(output, {
			links: true,
			fileName: true,
			title: true,
		});
		return output;
	}

	// getLinkSourcePath() inherits the base Formatter default (null);
	// CaptureChoiceFormatter overrides it with the capture destination.

	protected getCurrentFileLink(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		return this.app.fileManager.generateMarkdownLink(currentFile, "");
	}

	protected getCurrentFileName(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		return currentFile.basename;
	}

	/**
	 * {{foldercurrent}}: the active file's parent folder, vault-relative with no
	 * trailing slash. Obsidian's root TFolder has path "/", which collapses to ""
	 * (matching setTargetFolderPath) so a root-level note yields a root-relative
	 * sibling path instead of a literal leading "/". Uses the LIVE active file,
	 * byte-consistent with getCurrentFileName/getCurrentFileLink.
	 */
	protected getCurrentFolderPath(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		const parentPath = currentFile.parent?.path ?? "";
		return parentPath === "/" ? "" : parentPath;
	}

	/**
	 * Resolves {{linksection}} to a link to the current file at the heading the
	 * cursor is currently under, e.g. `[[Note#Heading]]`, so clicking it scrolls
	 * to that heading instead of the top of the file (issue #387).
	 *
	 * Read-only: it reads the active editor's cursor + the heading cache and
	 * never modifies any file. Falls back to a plain whole-file link (like
	 * {{linkcurrent}}) when there is no usable heading above the cursor, and to
	 * `null` only when there is no active file at all (so the required/optional
	 * behavior matches {{linkcurrent}}). The source path is shared with
	 * {{linkcurrent}} via {@link getLinkSourcePath}, so relative links resolve
	 * against the capture destination just like {{linkcurrent}} does.
	 */
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

	/**
	 * Builds the `#Heading` (or `#Parent#Child` when needed for disambiguation)
	 * subpath for the heading the cursor sits in, or null when none applies
	 * (no editor for this file, reading mode, no cursor, or no heading above the
	 * cursor). Delegates the pure selection/disambiguation/sanitization logic to
	 * {@link buildSectionSubpath}.
	 *
	 * Headings are parsed from the LIVE editor buffer (via {@link
	 * extractHeadingsFromLines}) rather than the metadata cache, so a just-typed
	 * heading or a brand-new note works without waiting for the cache to reindex.
	 */
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
		const headings = extractHeadingsFromLines(
			editor.getValue().split(/\r?\n/),
		);

		return buildSectionSubpath(headings, cursor.line);
	}

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	protected shouldUseSelectionForValue(): boolean {
		return true;
	}

	protected async getSelectedTextForValue(): Promise<string> {
		return await this.getSelectedText();
	}

	/**
	 * Central guard for every token prompt this formatter can open. The requirement
	 * collector pre-collects the inputs it can see, but tokens hidden behind a
	 * format-syntax template path or capture target (which it cannot resolve up
	 * front) still reach the formatter at runtime. On a non-interactive run (the CLI
	 * without `ui`) there is no one to answer such a prompt, so opening it would hang
	 * forever — abort with an actionable error instead. GUI runs leave `interactive`
	 * at its default (true/undefined) and are unaffected.
	 */
	private assertInteractivePrompt(what: string): void {
		if (this.choiceExecutor?.interactive === false) {
			throw new ChoiceAbortError(
				`This run is non-interactive but a value for ${what} was not provided up front. ` +
					`Pass it (e.g. a value- flag) or re-run with the ui flag.`,
			);
		}
	}

	/**
	 * The anonymous `{{VALUE}}` prompt. Its title, placeholder and context line
	 * come from the scope the caller declared for the string being formatted, so
	 * a Template's title prompt and a Capture's text prompt stop looking
	 * identical (issue #1546). The derived title is used ONLY when the answer is
	 * the whole string; otherwise the choice name stays the title and only the
	 * placeholder names the field, because "Note title" over a format of
	 * `{{DATE:YYYY-MM-DD}} {{VALUE}}` would invite the user to retype the date.
	 */
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
							this.valuePromptContext.description ??
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
						this.valuePromptContext.description ??
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
			// Route to a remote interactive session (Raycast) when one is driving.
			// PromptProvider has no context-line channel, so it is folded into the
			// header - otherwise a remote run would come out of this change with
			// LESS context than before (the header used to be the choice name).
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
				const description = this.valuePromptContext?.description;
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
						description,
						promptOptions,
					);
				} else {
					this.value = await promptFactory.Prompt(
						this.app,
						prompt.title,
						placeholder,
						defaultValue,
						description,
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

		// |type:checkbox forces a true/false picker (no free text). An active editor
		// selection must not short-circuit that contract: only accept the selection
		// when it is itself a boolean ("true"/"false", case/space-insensitive),
		// otherwise return undefined so promptForValue falls through to the forced
		// true/false picker instead of storing arbitrary selected text.
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
		// Image paste only for free-text prompts opened while formatting note
		// CONTENT — never for number/slider (numeric sinks) and never during
		// path passes (see contentValuePromptsAcceptImagePaste). The checkbox
		// picker never reaches the input-prompt factory.
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

	protected async promptForVariable(
		header?: string,
		context?: PromptContext,
	): Promise<string> {
		// Route to a remote interactive session (Raycast) when one is driving.
		const provider = this.choiceExecutor?.promptProvider;
		if (provider) {
			if (context?.type === "VDATE") {
				return await provider.datePrompt(
					header ?? context.label ?? "Enter date",
					{
						defaultValue: context.defaultValue,
						dateFormat: context.dateFormat ?? "YYYY-MM-DD",
						// Carry |time/|datetime so the remote client renders a time
						// picker; otherwise the picked time is silently dropped.
						withTime: context.withTime,
					},
				);
			}
			if (context?.inputTypeOverride === "checkbox") {
				return String(
					await provider.suggester(
						["true", "false"],
						["true", "false"],
						context.description ?? header ?? context.label ?? "Choose value",
						false,
					),
				);
			}
			return await provider.inputPrompt(
				header ?? context?.label ?? "Enter value",
				context?.placeholder,
				context?.defaultValue,
			);
		}
		this.assertInteractivePrompt(
			header ? `{{VALUE:${header}}}` : "a template variable",
		);
		try {
			// Named prompts already title themselves with the variable name, so they
			// only gain the run context: which choice is asking, and where the
			// answer lands (issue #1546).
			const variableTitle = header ?? context?.label ?? "Enter value";
			const showDestination = scopeShowsDestination(this.promptScope);
			const namedContextLine = buildPromptContextLine(
				this.promptRunContext,
				variableTitle,
				{ showDestination },
			);
			const namedContextLineFull = buildPromptContextLine(
				this.promptRunContext,
				variableTitle,
				{ elide: false, showDestination },
			);

			// Use VDateInputPrompt for VDATE variables
			if (context?.type === "VDATE") {
				return await VDateInputPrompt.Prompt(
					this.app,
					(header as string) ?? context.label ?? "Enter date",
					context.withTime
						? "Enter a date & time (e.g., 'tomorrow at 3pm', '2025-12-25 14:30')"
						: "Enter a date (e.g., 'tomorrow', 'next friday', '2025-12-25')",
					context.defaultValue,
					context.dateFormat ?? "YYYY-MM-DD",
					{
						optional: context.optional,
						contextLine: namedContextLine,
						contextLineFull: namedContextLineFull,
						draftScopeId: this.promptRunContext?.draftScopeId,
					},
					context.withTime,
				);
			}

			// {{VALUE:x|type:checkbox}} renders a forced true/false picker (no
			// free text) so the written `x: true` round-trips as a Checkbox. The
			// |label (carried as description for single-value tokens) becomes the
			// modal title so the user knows which property they are setting (#202).
			if (context?.inputTypeOverride === "checkbox") {
				return await GenericSuggester.Suggest(
					this.app,
					["true", "false"],
					["true", "false"],
					context.description ?? header ?? context.label ?? "Choose value",
					undefined,
					context.optional ? { skippable: true } : undefined,
				);
			}

			// Use default prompt for other variables
			return await new InputPrompt().factory(context?.inputTypeOverride).Prompt(
				this.app,
				variableTitle,
				context?.placeholder ??
					(context?.defaultValue ? context.defaultValue : undefined),
				context?.defaultValue,
				context?.description,
				this.buildInputPromptOptions(
					context,
					namedContextLine,
					namedContextLineFull,
				),
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}
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

	protected async suggestForValue(
		suggestedValues: string[],
		allowCustomInput = false,
		context?: {
			placeholder?: string;
			variableKey?: string;
			displayValues?: string[];
			optional?: boolean;
		},
	) {
		// Route to a remote interactive session (Raycast) when one is driving this
		// run - covers `{{VALUE:a,b,c}}` option lists in a template/capture format
		// (e.g. a rating field) that the requirement collector didn't pre-satisfy.
		const provider = this.choiceExecutor?.promptProvider;
		if (provider) {
			// Formatter tokens resolve to strings; the provider hands back the
			// selected actualItems entry (here always a string) or a custom value.
			return String(
				await provider.suggester(
					context?.displayValues ?? suggestedValues,
					suggestedValues,
					context?.placeholder,
					allowCustomInput,
				),
			);
		}
		this.assertInteractivePrompt(
			context?.variableKey ? `{{VALUE:${context.variableKey}}}` : "a value choice",
		);
		try {
			const displayValues = context?.displayValues ?? suggestedValues;
			if (allowCustomInput) {
				return await InputSuggester.Suggest(
					this.app,
					displayValues,
					suggestedValues,
					{
						...(context?.placeholder
							? { placeholder: context.placeholder }
							: {}),
						...(context?.optional ? { skippable: true } : {}),
					},
				);
			}
			return await GenericSuggester.Suggest(
				this.app,
				displayValues,
				suggestedValues,
				context?.placeholder,
				undefined,
				context?.optional ? { skippable: true } : undefined,
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}
	}

	protected async suggestForValueMulti(
		suggestedValues: string[],
		allowCustomInput = false,
		context?: {
			placeholder?: string;
			variableKey?: string;
			displayValues?: string[];
			optional?: boolean;
		},
	): Promise<string[]> {
		const displayValues = context?.displayValues ?? suggestedValues;
		// Route to a remote interactive session (Raycast) when one is driving.
		const provider = this.choiceExecutor?.promptProvider;
		if (provider) {
			return await provider.suggesterMulti(displayValues, suggestedValues, {
				placeholder: context?.placeholder,
				allowCustomInput,
			});
		}
		this.assertInteractivePrompt(
			context?.variableKey
				? `{{VALUE:${context.variableKey}}}`
				: "a multi-select value",
		);
		try {
			return await MultiSuggester.Suggest(
				this.app,
				displayValues,
				suggestedValues,
				{
					...(context?.placeholder
						? { placeholder: context.placeholder }
						: {}),
					allowCustomValue: allowCustomInput,
					...(context?.optional ? { skippable: true } : {}),
				},
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}
	}

	protected async suggestForField(fieldInput: string): Promise<string | string[]> {
		this.assertInteractivePrompt(`{{FIELD:${fieldInput}}}`);
		// Route the final picker to a remote interactive session (Raycast) when one
		// is driving; the vault-side value collection below still runs unchanged.
		const provider = this.choiceExecutor?.promptProvider;
		try {
			// Parse the field input to extract field name and filters. Do NOT warn
			// on unknown keys here: the field replacer in formatter.ts already parses
			// the same token with { warnUnknown: true } before calling this, so
			// warning again would emit a duplicate notice per malformed FIELD token.
			const { fieldName, filters, multiSelect } =
				FieldSuggestionParser.parse(fieldInput);

			// Resolve the active-note default (issue #1429) BEFORE collection but apply
			// it AFTER, so the resolved value never enters the collection cache key
			// (which is keyed partly on filters.defaultValue). Gate strictly on
			// "active"; an unknown source is ignored. `null` => no usable active value
			// (no/non-Markdown active file, or a missing/empty/object property).
			const activeDefault =
				filters.defaultFrom === "active"
					? resolveActiveNoteFieldDefault(
							this.app,
							this.choiceExecutor?.triggerContext?.activeFile ?? null,
							fieldName,
						)
					: null;

			// Collect and process via shared collector (filters unmutated).
			const { values: collectedValues, hasDefaultValue: literalHasDefault } =
				await collectFieldValuesProcessedDetailed(this.app, fieldName, filters);

			let values = collectedValues;
			let hasDefaultValue = literalHasDefault;
			// The default shown in the placeholder hint: the active-note value wins
			// over a literal |default: when both are present.
			let effectiveDefault = filters.defaultValue;

			if (!multiSelect && typeof activeDefault === "string") {
				// Promote the active note's scalar value to the top so an empty-query
				// Enter accepts it, matching the existing default-always semantics.
				values = FieldValueProcessor.promoteValueToFront(
					values,
					activeDefault,
					filters.caseSensitive,
				);
				effectiveDefault = activeDefault;
				hasDefaultValue = true;
			} else if (
				!multiSelect &&
				Array.isArray(activeDefault) &&
				activeDefault.length > 0
			) {
				// A list-valued property has no single default; lists apply to |multi
				// only. Log (console-only) so a user expecting a default isn't mystified.
				log.logMessage(
					`{{FIELD:${fieldName}|default-from:active}}: the active note's "${fieldName}" is a list value, which applies only to |multi FIELD prompts, so no default was prefilled.`,
				);
			}

			// Enhance placeholder with context
			let placeholder = multiSelect
				? `Select values for ${fieldName}`
				: `Enter value for ${fieldName}`;
			if (hasDefaultValue && effectiveDefault) {
				placeholder = multiSelect
					? `Select values for ${fieldName} (default: ${effectiveDefault})`
					: `Enter value for ${fieldName} (default: ${effectiveDefault})`;
			}

			if (multiSelect) {
				// When the vault has no existing values yet, seed the picker with the
				// same smart defaults the single-select no-values fallback surfaces
				// (e.g. To Do / In Progress / Done), so a brand-new {{FIELD:x|multi}}
				// offers starting hints instead of an empty list. Custom values stay
				// enabled so the user can still type anything.
				let multiValues = values;
				if (values.length === 0 && !filters.defaultValue) {
					const smartDefaults = FieldValueProcessor.getSmartDefaults(
						fieldName,
						[],
					);
					if (smartDefaults.length > 0) multiValues = smartDefaults;
				}
				// Pre-check the active note's value(s) (scalar -> one, list -> each).
				// Never [undefined]: activeDefault is null | string | string[].
				// Canonicalize each against the collected suggestions under the dedup
				// case fold, so an active "Done" toggles a collected "done" option
				// instead of adding a duplicate custom row (matching FIELD's
				// case-insensitive dedup).
				const preselected =
					activeDefault === null
						? undefined
						: (Array.isArray(activeDefault)
								? activeDefault
								: [activeDefault]
							).map((v) =>
								FieldValueProcessor.canonicalizeAgainst(
									multiValues,
									v,
									filters.caseSensitive,
								),
							);
				// Route to a remote interactive session (Raycast) when one is driving.
				if (provider) {
					return await provider.suggesterMulti(multiValues, multiValues, {
						placeholder,
						allowCustomInput: true,
						preselected:
							preselected && preselected.length > 0 ? preselected : undefined,
					});
				}
				return await MultiSuggester.Suggest(this.app, multiValues, multiValues, {
					placeholder,
					allowCustomValue: true,
					...(preselected && preselected.length > 0
						? { preselected }
						: {}),
				});
			}

			if (values.length === 0) {
				// No values found even after processing defaults
				let fallbackPrompt = `No existing values were found in your vault.`;

				// Suggest smart defaults if no custom default was provided
				if (!filters.defaultValue) {
					const smartDefaults = FieldValueProcessor.getSmartDefaults(
						fieldName,
						[],
					);
					if (smartDefaults.length > 0) {
						fallbackPrompt += `\n\nSuggested values for ${fieldName}: ${smartDefaults.slice(0, 3).join(", ")}`;
					}
				}

				if (provider) {
					return await provider.inputPrompt(
						`Enter value for ${fieldName}`,
						fallbackPrompt,
					);
				}
				return await GenericInputPrompt.PromptWithContext(
					this.app,
					`Enter value for ${fieldName}`,
					fallbackPrompt,
					undefined,
					this.getLinkSourcePath() ?? undefined,
					undefined,
					{ allowPeek: true },
				);
			}

			if (provider) {
				return String(
					await provider.suggester(values, values, placeholder, true),
				);
			}
			return await InputSuggester.Suggest(this.app, values, values, {
				placeholder,
			});
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}
	}

	private generateCacheKey(filters: FieldFilter): string {
		return generateFieldCacheKey(filters);
	}

	protected async suggestForFile(parsed: ParsedFileToken): Promise<string | string[]> {
		this.assertInteractivePrompt(
			`{{FILE}} (pick a file from ${parsed.folderPath})`,
		);
		// Route the final picker to a remote interactive session (Raycast) when one
		// is driving; the vault-side file filtering below still runs unchanged.
		const provider = this.choiceExecutor?.promptProvider;
		try {
			const files = EnhancedFieldSuggestionFileFilter.filterFiles(
				this.app.vault.getMarkdownFiles(),
				parsed.filter,
				(file) => this.app.metadataCache.getFileCache(file),
			);

			const placeholder =
				parsed.label ?? `Select a file from ${parsed.folderPath}`;

			// Empty folder (or no match): fall back to free-text so a capture never
			// dead-ends, mirroring suggestForField. A typed value is stored as custom
			// (never resolved to a real file); an empty/skip stays "".
			if (files.length === 0) {
				const description = `No markdown files found in "${parsed.folderPath}". Type a value or leave empty.`;
				const typed = provider
					? await provider.inputPrompt(placeholder, description)
					: await GenericInputPrompt.Prompt(
							this.app,
							placeholder,
							description,
							undefined,
							undefined,
							{ optional: parsed.optional || undefined, allowPeek: true },
						);
				if (parsed.multiSelect) {
					return typed ? [`${FILE_CUSTOM_PREFIX}${typed}`] : [];
				}
				return typed ? `${FILE_CUSTOM_PREFIX}${typed}` : "";
			}

			const displayItems = buildFileDisplayLabels(
				files,
				(file) => this.app.metadataCache.getFileCache(file),
			);
			const items = files.map((file) => `${FILE_PICK_PREFIX}${file.path}`);

			if (parsed.multiSelect) {
				const result = provider
					? await provider.suggesterMulti(displayItems, items, {
							placeholder,
							allowCustomInput: parsed.allowCustomInput,
						})
					: await MultiSuggester.Suggest(this.app, displayItems, items, {
							placeholder,
							allowCustomValue: parsed.allowCustomInput,
							...(parsed.optional ? { skippable: true } : {}),
						});
				return result.map((item) =>
					items.includes(item) ? item : `${FILE_CUSTOM_PREFIX}${item}`,
				);
			}

			if (provider) {
				const result = String(
					await provider.suggester(
						displayItems,
						items,
						placeholder,
						parsed.allowCustomInput,
					),
				);
				if (!result) return "";
				return items.includes(result)
					? result
					: `${FILE_CUSTOM_PREFIX}${result}`;
			}

			if (parsed.allowCustomInput) {
				const basenames = new Set(
					files.map((file) => file.basename.toLowerCase()),
				);
				const displayLabels = new Set(
					displayItems.map((label) => label.toLowerCase()),
				);
				const result = await InputSuggester.Suggest(
					this.app,
					displayItems,
					items,
					{
						placeholder,
						// Typing a real basename (e.g. "Tom", or "tom") should pick that
						// file, not add a separate, indistinguishable custom row.
						valueExists: (typed) =>
							basenames.has(typed.toLowerCase()) ||
							displayLabels.has(typed.toLowerCase()),
						...(parsed.optional ? { skippable: true } : {}),
					},
				);
				if (!result) return ""; // skipped
				// A chosen row returns the encoded item; anything else is a type-in.
				return items.includes(result)
					? result
					: `${FILE_CUSTOM_PREFIX}${result}`;
			}

			const result = await GenericSuggester.Suggest(
				this.app,
				displayItems,
				items,
				placeholder,
				undefined,
				parsed.optional ? { skippable: true } : undefined,
			);
			return result ?? "";
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}
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
		// An include spliced into a path is part of that path: keep the caller's
		// scope so its prompts do not claim to be asking for note content.
		if (this.promptScope !== "generic") {
			childEngine.setPromptScope(this.promptScope);
		}
		// Included templates prompt through the child's own formatter, so the run
		// context has to travel with them or their prompts lose the choice name.
		// The draft scope is narrowed to this template: the child raises its OWN
		// {{VALUE}} prompt in the same run, and sharing the parent's draft key
		// would open it pre-filled with the parent's answer.
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

		while (INLINE_JAVASCRIPT_REGEX.test(output)) {
			const match = INLINE_JAVASCRIPT_REGEX.exec(output);
			if (!match) break;
			const code = match.at(1)?.trim();

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

				let replacement = "";
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
							matchStart: match.index,
							matchEnd: match.index + match[0].length,
							rawValue: outVal,
							fallbackKey: "inlineScript",
							heuristicEnabled: this.isTemplatePropertyTypesEnabled(),
						}) ?? String(outVal);
				}
				// null/undefined and unsupported values intentionally keep the
				// legacy empty-output behavior rather than inventing serialization.
				output = this.replacer(
					output,
					INLINE_JAVASCRIPT_REGEX,
					replacement,
				);
			} else {
				// Empty/whitespace-only fence (e.g. ```js quickadd\n```): consume the
				// matched block so the loop terminates instead of spinning forever.
				output = this.replacer(output, INLINE_JAVASCRIPT_REGEX, "");
			}
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
