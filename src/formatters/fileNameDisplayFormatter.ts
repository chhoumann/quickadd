import {
	defaultDateVariableFormat,
	findInlineScriptSpans,
	Formatter,
	hasUnterminatedInlineScriptFence,
	renderStoredDateVariable,
	type PromptContext,
} from "./formatter";
import { parseVDateOptionsForPreview } from "../utils/vdateSyntax";
import { snappedExampleDate } from "./helpers/snappedExampleDate";
import {
	describePreviewFailure,
	PreviewDiagnostics,
} from "./previewDiagnostics";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { DATE_VARIABLE_REGEX, GLOBAL_VAR_REGEX, TITLE_REGEX } from "../constants";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import {
	getVariableExample,
	getMacroPreview,
	getVariablePromptExample,
	getSuggestionPreview,
	fieldValuePreview,
	fileNameSafeStandIn,
	getCurrentFileLinkPreview,
	getCurrentFileLinkToSectionPreview,
	getCurrentFileNamePreview,
	getCurrentFolderPathPreview,
	DateFormatPreviewGenerator
} from "./helpers/previewHelpers";
import {
	describeIllegalFilePathChars,
	findIllegalFilePathChars,
	previewGeneratedFilePath,
} from "../utils/generatedFilePath";
import { getTemplateFile } from "../utils/templateFolderUtils";
import { getValueVariableBaseName } from "../utils/valueSyntax";
import { EnhancedFieldSuggestionFileFilter } from "../utils/EnhancedFieldSuggestionFileFilter";
import { FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, type ParsedFileToken } from "../utils/fileSyntax";

import type QuickAdd from "../main";

/**
 * Includes one preview pass may expand, across the whole format string.
 * Generous next to any real naming template (which includes one file, or none),
 * and small enough that a pathological include tree cannot stall a keystroke.
 */
const MAX_PREVIEW_TEMPLATE_INCLUDES = 25;

/**
 * Is the last `{{` in `input` still waiting for its `}}`?
 *
 * `indexOf` scans, not a regex: this runs on every keystroke over a string that
 * can be a whole included template body, and a lazy `/\{\{[\s\S]*?\}\}/` over
 * that is quadratic on pathological input (the shape this repo has fixed four
 * times over).
 */
function hasUnterminatedToken(input: string): boolean {
	const lastOpen = input.lastIndexOf("{{");
	if (lastOpen === -1) return false;
	return input.indexOf("}}", lastOpen + 2) === -1;
}

/**
 * `text` with any inline `js quickadd` fence removed.
 *
 * The run replaces a fence with whatever the script RETURNS
 * (`replaceInlineJavascriptInString` is its very first pass), while the preview
 * leaves the source verbatim - by design, it must not execute anything (#1558).
 * So the fence's own punctuation is never in the created name, and reading the
 * preview literally there would report a colon out of somebody's JavaScript.
 * Same helper and the same reason as the template pass above (#1467).
 *
 * Known and accepted gap: a fence that only APPEARS after expansion - carried in
 * by a `{{GLOBAL_VAR:}}` snippet, whose pass runs after the run's inline-JS pass
 * has already gone by - is stripped here although the run would keep it as
 * literal text. Mapping spans back through the passes to tell the two apart is
 * not worth it for a script inside a global variable inside a file name, and the
 * failure is silence rather than a wrong accusation.
 */
function textOutsideScriptSpans(text: string): string {
	const spans = findInlineScriptSpans(text);
	if (spans.length === 0) return text;

	let output = "";
	let index = 0;
	for (const span of spans) {
		output += text.slice(index, span.start);
		index = span.end;
	}
	return output + text.slice(index);
}

export class FileNameDisplayFormatter extends Formatter {
	constructor(
		app: App,
		private readonly plugin?: QuickAdd,
		dateParser?: IDateParser,
	) {
		super(app);
		this.dateParser = dateParser || NLDParser;
	}

	/**
	 * Problems this pass ran into, for passive display beside the preview.
	 *
	 * A preview is a speculative evaluation of INCOMPLETE input, re-run on every
	 * keystroke, so it must not have the run's side effects: while you type
	 * `pascal` into `{{VALUE:title|case:}}` every prefix is a complete, invalid
	 * token, and the inherited `log.logWarning` stacked one Obsidian Notice per
	 * character (issue #1558). The real run still warns; this collects.
	 *
	 * Replaced at the start of every `format()` so a pass never inherits the
	 * previous one's complaints.
	 */
	public diagnostics = new PreviewDiagnostics();

	protected warn(message: string): void {
		this.diagnostics.add("warning", message);
	}

	protected reportProblem(message: string): void {
		this.diagnostics.add("error", message);
	}

	/**
	 * Includes this pass may still expand. See {@link getTemplateContent}.
	 */
	private templateIncludeBudget = MAX_PREVIEW_TEMPLATE_INCLUDES;

	public async format(input: string): Promise<string> {
		let output: string = input;
		this.diagnostics = new PreviewDiagnostics();
		this.templateIncludeBudget = MAX_PREVIEW_TEMPLATE_INCLUDES;

		try {
			output = await this.formatInternal(input, { included: false });
		} catch (error) {
			// Return the input as-is if formatting fails during preview. The failure
			// itself is the most useful thing the preview can say, so it goes on the
			// diagnostics channel rather than being swallowed (issue #1558).
			const described = describePreviewFailure(error);
			if (described) this.diagnostics.add("error", described);
			return input;
		}

		// Before the normalizer, mirroring the run: formatFileName's
		// circular-dependency check runs on the formatted string, and if it fires
		// the choice dies there - no name is ever normalized (#1588).
		this.reportCircularTitle(input, output);

		// The run puts every generated name through this normalizer on the way to
		// the vault (TemplateChoiceEngine, TemplateInsertEngine,
		// templateNoteDiscovery, and the capture target via
		// captureTargetResolution), so a preview that skips it asserts a name the
		// run will never create: a trailing "." or space is stripped, a backslash is
		// a path separator, and a run of line breaks - the shape a {{TEMPLATE:}}
		// body arrives in - collapses to one space (#1563). Non-throwing here: a
		// preview evaluates incomplete input on every keystroke, so the rejections
		// the run would abort on become diagnostics instead.
		const normalized = previewGeneratedFilePath(output);
		for (const problem of normalized.problems) {
			// "path": the format resolved fine, the vault just will not take the
			// result. A host that knows this field may not be a path at all (the
			// capture target) discards exactly these.
			this.diagnostics.add("error", problem, "path");
		}
		// On `output`, not `normalized.path`: the normalizer collapses the line
		// breaks that delimit an inline script fence, and the scan below has to
		// still be able to find one. It costs nothing - the normalizer only trims
		// trailing dots/spaces and collapses control runs, so it can neither add
		// nor remove one of these characters.
		this.reportIllegalChars(input, output);
		return normalized.path;
	}

	/**
	 * Says so when the format can never produce a name at all, because it uses
	 * {{title}} (#1588).
	 *
	 * `CompleteFormatter.formatFileName` rejects this token outright - the title
	 * IS the file name, so deriving one from the other is circular - and it does
	 * so twice: on the raw input, and again on `format()`'s output, because an
	 * expanded `{{GLOBAL_VAR:}}` snippet or a `{{VALUE}}` that resolves to the
	 * literal text can smuggle one in after the first check. Both halves are
	 * mirrored here, on the same inputs, so the preview refuses exactly what the
	 * run refuses.
	 *
	 * NOT `kind: "path"`. The token is still on screen unresolved, so the row
	 * says "Unresolved:" and means it - and the capture target, which discards
	 * path problems as "this field may not be a path", must keep this one:
	 * `formatFileName` is that field's entry point too, so `{{title}}` aborts a
	 * capture just as hard.
	 */
	private reportCircularTitle(input: string, output: string): void {
		if (!TITLE_REGEX.test(input) && !TITLE_REGEX.test(output)) {
			return;
		}
		this.reportProblem(
			"A file name cannot contain {{title}}, because the title is derived from the file name itself - so this choice would fail at run time.",
		);
	}

	/**
	 * Says so when the name on screen is one Obsidian will not create (#1578).
	 *
	 * The check reads the FINISHED name rather than the format string, because
	 * that is the only place all the sources meet: a colon the author typed, one
	 * `{{TIME}}` produced (it is `HH:mm`, and the token autocomplete offers it in
	 * this field), one a `{{GLOBAL_VAR:}}` snippet or an included `{{TEMPLATE:}}`
	 * body carried in, and one left behind by a token that never matched
	 * (`{{TEMPLATE:Naming}}` without the extension is not a token, so the literal
	 * text goes to the vault). Reading the format string instead would need a
	 * token mask, and a mask is blind to exactly the last case - a typo, which is
	 * when the preview most needs to speak.
	 *
	 * What keeps it from crying wolf: the preview's own stand-ins are kept
	 * name-shaped ({@link fileNameSafeStandIn}, and the VDATE hints are gone),
	 * plus the guards below.
	 */
	private reportIllegalChars(input: string, name: string): void {
		// A pass that already failed has said something better. All four of this
		// formatter's `[QuickAdd: ...]` placeholders carry a colon and all four
		// report their real problem first, so without this the row would pile a
		// second, misleading sentence on top of "Template not found".
		if (this.diagnostics.hasError) return;

		// Mid-token. `Notes/{{DATE:` is what the field holds for as long as
		// someone reads the format-suggester popup that this exact prefix opens,
		// and the unmatched token stays literal in the output - so the colon is
		// the caret's position, not a mistake. Costs only a literal `{{` in a
		// name, which no format string has.
		// ...and mid-SCRIPT, for the same reason: until the closing backticks are
		// typed there is no span to strip, so the half-written JavaScript is read
		// as part of the name, and `{a: 1}` or `"HH:mm"` in it turns the row red
		// on every pause.
		if (hasUnterminatedToken(input) || hasUnterminatedInlineScriptFence(input)) {
			return;
		}

		const illegal = findIllegalFilePathChars(textOutsideScriptSpans(name));
		if (illegal.length === 0) return;

		// A file that is already there is never created, so Obsidian is never
		// asked to accept its name. `:` is legal on macOS/Linux at the filesystem
		// level, so a note made outside Obsidian really can carry one - and a
		// capture pointed at it appends happily (CaptureChoiceEngine takes the
		// `fileExists` branch and never reaches `vault.create`), as does a
		// Template choice set to append/increment. Claiming otherwise would mark a
		// working configuration broken.
		if (this.existsInVault(name)) return;

		this.diagnostics.add("error", describeIllegalFilePathChars(illegal), "path");
	}

	/**
	 * Is the thing this name refers to already in the vault? Tolerant of the
	 * missing extension, because a "File name format" produces the name and the
	 * engine appends `.md` (`normalizeMarkdownFilePath`), while a capture target
	 * usually carries one already.
	 *
	 * SHAPE-AWARE, because Obsidian's path map holds files AND folders with no
	 * trailing slash on either, and a bare `getAbstractFileByPath` conflated
	 * them:
	 *
	 * - a capture target written as `Meetings: 2026/` names a FOLDER to pick
	 *   inside, and the folder existing is exactly what makes it work - yet the
	 *   trailing slash matched neither probe, so the row went red for a capture
	 *   that runs fine;
	 * - a bare `Meetings: 2026` may ALSO be a folder scope, and
	 *   `captureTargetResolution` says exactly when: an existing folder with no
	 *   real note at `Meetings: 2026.md`. That rule is mirrored here rather than
	 *   approximated, so the preview and the resolver agree.
	 *
	 * Accepted residual, unchanged from before: a FOLDER named exactly like a
	 * Template choice's file-name format excuses the warning, although the run
	 * would still fail creating the `.md` beside it. Telling the two hosts apart
	 * needs the host to say which it is, and erring toward silence is this
	 * cluster's rule - a wrong accusation is worse than a missing one.
	 */
	private existsInVault(name: string): boolean {
		const vault = this.app?.vault;
		// Defensive because this runs OUTSIDE format()'s try/catch: a preview that
		// throws its way out of a keystroke is the #1558 failure, and this is the
		// only vault call the pass makes.
		if (typeof vault?.getAbstractFileByPath !== "function") return false;
		const trimmed = name.trim();
		if (!trimmed) return false;

		if (trimmed.endsWith("/")) {
			return (
				vault.getAbstractFileByPath(trimmed.slice(0, -1)) instanceof TFolder
			);
		}

		if (vault.getAbstractFileByPath(trimmed) instanceof TFile) return true;
		const withExtension = vault.getAbstractFileByPath(`${trimmed}.md`);
		if (withExtension instanceof TFile) return true;
		// `captureTargetResolution` rule: a bare name that is an existing folder
		// with no real note beside it is a folder SCOPE, and the capture picks a
		// file inside it - nothing asks Obsidian to accept this string as a name.
		return vault.getAbstractFileByPath(trimmed) instanceof TFolder;
	}

	/**
	 * The preview pass list.
	 *
	 * `included` marks a `{{TEMPLATE:}}` body being resolved for splicing into
	 * the name. At run time that body goes through a child engine's
	 * `formatFileContent` (SingleTemplateEngine.run), which resolves the
	 * note-derived tokens with CONTENT semantics - so an included body previewed
	 * with the file-name pass list would leave literal exactly the tokens people
	 * put in templates ({{linkcurrent}}, {{linksection}}). `{{title}}` stays out
	 * of both: the run resolves it to the empty string here (the title is derived
	 * from the name being built, so it is not known yet), and neither a blank nor
	 * this formatter's example title is a preview worth showing.
	 */
	private async formatInternal(
		input: string,
		{ included }: { included: boolean },
	): Promise<string> {
		let output = input;

		// {{TEMPLATE:}} FIRST, mirroring the run (CompleteFormatter.format resolves
		// includes before globals and before {{VALUE}}). Resolving it later would
		// make the preview splice in a body for a token that a global snippet or a
		// value produced - which the run leaves literal, because its template pass
		// has already gone by. (The globals/macros order below is older than this
		// and is left as it was.)
		output = await this.replaceTemplateOutsideScripts(output);
		// Expand globals to preview inserted snippets
		output = await this.replaceGlobalVarInString(output);
		output = await this.replaceMacrosInString(output);
		output = this.replaceDateInString(output);
		output = this.replaceTimeInString(output);
		output = await this.replaceValueInString(output);
		output = await this.replaceSelectedInString(output);
		output = await this.replaceClipboardInString(output);
		output = await this.replaceDateVariableInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceFieldVarInString(output);
		output = await this.replaceFileInString(output);
		// Where the run has it (CompleteFormatter.format: after {{FILE:}}, before
		// {{RANDOM:}}). The run really does prompt here - formatFileName goes
		// through format() - so leaving {{MVALUE}} literal made the preview
		// promise a name with a token in it (#1587). `promptForMathValue` was
		// already overridden with a stand-in below; it was simply unreachable.
		output = await this.replaceMathValueInString(output);
		// Note-derived tokens in ONE pass so no token re-scans another's output
		// (#1358). Every preview resolver returns a placeholder rather than null,
		// so neither mode can hit the runtime's missing-active-file throw.
		output = this.replaceCurrentFileTokensInString(
			output,
			included
				? { links: true, fileName: true, folder: true, activeFolder: "content" }
				: { fileName: true, folder: true, activeFolder: "path" },
		);
		output = this.replaceRandomInString(output);

		return output;
	}

	protected async replaceGlobalVarInString(input: string): Promise<string> {
		let output = input;
		let guard = 0;
		const re = new RegExp(GLOBAL_VAR_REGEX.source, 'gi');
		while (re.test(output)) {
			if (++guard > 5) break;
			output = output.replace(re, (_m, rawName) => {
				const name = String(rawName ?? '').trim();
				if (!name) return _m;
				const snippet = this.plugin?.settings?.globalVariables?.[name];
				return typeof snippet === 'string' ? snippet : '';
			});
		}
		return output;
	}

	protected promptForValue(header?: string): string {
		// The header is a PROMPT header at run time, not part of the name, so an
		// unusable one degrades to the generic stand-in rather than putting a
		// character in the preview that the run would never produce.
		return fileNameSafeStandIn(header || "user input", "user input");
	}

	protected getVariableValue(variableName: string): string {
		const stored = this.variables.get(variableName);
		if (typeof stored === "string") return stored;
		const baseName = getValueVariableBaseName(variableName);
		return fileNameSafeStandIn(getVariableExample(baseName), "user input");
	}

	protected getCurrentFileLink(): string | null {
		if (!this.app) return null;
		return getCurrentFileLinkPreview(this.app.workspace.getActiveFile());
	}

	protected getCurrentFileName(): string | null {
		if (!this.app) return "current_filename";
		return getCurrentFileNamePreview(this.app.workspace.getActiveFile());
	}

	protected getCurrentFolderPath(): string | null {
		if (!this.app) return "current_folder";
		return getCurrentFolderPathPreview(this.app.workspace.getActiveFile());
	}

	protected suggestForValue(
		suggestedValues: string[],
		allowCustomInput = false,
		_context?: { placeholder?: string; variableKey?: string },
	) {
		// The first option, without the body preview's " (N options)" count: the
		// run splices in exactly the option that gets picked, so the count would
		// be text in a file name that no created file can have.
		return suggestedValues[0] ?? getSuggestionPreview(suggestedValues);
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("calculation_result");
	}

	protected getMacroValue(
		macroName: string,
		_context?: { label?: string },
	) {
		return fileNameSafeStandIn(getMacroPreview(macroName), "macro_output");
	}

	protected async promptForVariable(
		variableName: string,
		context?: PromptContext
	): Promise<string> {
		return fileNameSafeStandIn(
			getVariablePromptExample(variableName),
			"user input",
		);
	}

	/**
	 * The template pass, skipping inline script fences.
	 *
	 * A fence is verbatim JavaScript source, and the run consumes it BEFORE its
	 * template pass (`replaceInlineJavascriptInString` is the run's first pass), so
	 * a `"{{TEMPLATE:N.md}}"` written as a string literal inside a script is never
	 * an include at run time. The preview has no inline-JS pass at all - by design,
	 * it must not execute anything - so without this it would read that path,
	 * splice the body into the middle of the displayed source, and report a
	 * "Template not found" ERROR for a format that is fine.
	 *
	 * Same protection, same helper, and the same reason as
	 * `expandLinebreakEscapesOutsideTokens` (#1467).
	 */
	private async replaceTemplateOutsideScripts(input: string): Promise<string> {
		const spans = findInlineScriptSpans(input);
		if (spans.length === 0) return this.replaceTemplateInString(input);

		let output = "";
		let index = 0;
		for (const span of spans) {
			output += await this.replaceTemplateInString(
				input.slice(index, span.start),
			);
			output += input.slice(span.start, span.end);
			index = span.end;
		}
		return output + (await this.replaceTemplateInString(input.slice(index)));
	}

	/**
	 * Previews an included template's body WITHOUT the runtime engine (#1563).
	 *
	 * `formatFileName` really does resolve `{{TEMPLATE:}}` - `format()` runs
	 * `replaceTemplateInString`, and path prompt scope is deliberately propagated
	 * into the child engine - so leaving the token literal made the preview say
	 * `{{TEMPLATE:Naming.md}}-My Note` while the run produced whatever Naming.md
	 * rendered to. The one-page input form contradicted itself even harder: its
	 * preflight scans INTO the include for that same field, so it would prompt
	 * for a variable it could only have found inside the template, and then
	 * preview the unresolved token beside the answer.
	 *
	 * Reading it through THIS formatter is what keeps the preview inert: the same
	 * substitutions the top level gets, no prompts, no macro engine, no inline JS
	 * (issue #1558). Building a `SingleTemplateEngine` here would construct a real
	 * `CompleteFormatter` and open blocking modals on every keystroke, which is
	 * the bug #1560 fixed on the content field.
	 */
	protected async getTemplateContent(templatePath: string): Promise<string> {
		const app = this.app;
		if (!app) {
			this.reportProblem(`Template preview unavailable: ${templatePath}`);
			return `[QuickAdd: template preview unavailable] ${templatePath}`;
		}

		// Depth and cycle detection (in the shared `replaceTemplateInString`) both
		// unwind per include, so neither bounds a format string that keeps
		// producing NEW includes - and it can, now that the template pass runs
		// before global expansion: a global snippet holding a {{TEMPLATE:}} token
		// re-arms the loop with an empty `visited` set. One budget for the whole
		// pass terminates that, and bounds the fan-out of a wide include tree on a
		// field that resolves on every keystroke.
		if (this.templateIncludeBudget <= 0) {
			const placeholder = `[QuickAdd: too many template includes to preview]`;
			this.reportProblem(placeholder);
			return placeholder;
		}

		const file = getTemplateFile(app, templatePath);
		if (!file) {
			// An error, not a quiet placeholder: the run THROWS here
			// (TemplateEngine.getTemplateContent) and the choice dies, so the row
			// must read "Unresolved:" rather than presenting a name.
			this.reportProblem(`Template not found: ${templatePath}`);
			return `[QuickAdd: template not found] ${templatePath}`;
		}

		this.templateIncludeBudget--;
		// The depth counter is preview-LOCAL on purpose. At run time
		// `CompleteFormatter.getTemplateContent` hands the child engine a COPY of
		// the state with depth + 1, while `visited` is shared by reference - so
		// incrementing depth inside the shared `replaceTemplateInString` would
		// advance the runtime by two per level and halve its inclusion limit. The
		// preview has no child formatter to carry it, so it counts here.
		this.templateInclusion ??= { visited: new Set<string>(), depth: 0 };
		this.templateInclusion.depth++;
		try {
			const body = await app.vault.cachedRead(file);
			const resolved = this.resolveTitleInIncludedBody(
				await this.formatInternal(body, { included: true }),
			);
			this.warnIfJoinedIntoOneLine(templatePath, resolved);
			return resolved;
		} catch (error) {
			// Contained here rather than by format()'s catch, so one bad token
			// inside an included template does not blank the whole field's preview.
			const described = describePreviewFailure(error);
			if (described) this.diagnostics.add("error", described);
			return `[QuickAdd: template preview failed] ${templatePath}`;
		} finally {
			this.templateInclusion.depth--;
		}
	}

	/**
	 * `{{title}}` inside a spliced-in `{{TEMPLATE:}}` body, resolved the way the
	 * run's child engine resolves it.
	 *
	 * At run time an included body goes through `SingleTemplateEngine` ->
	 * `CompleteFormatter.formatFileContent`, whose single-pass token resolver
	 * runs with `title: true` and takes `variables.get("title") ?? ""` - so the
	 * literal token never survives into the name that `formatFileName`'s
	 * circular-dependency check then reads, and the run does NOT abort.
	 *
	 * Doing it here rather than in `formatInternal`'s `included` branch is
	 * deliberate: routing `title` through the shared resolver would call this
	 * class's `getVariableValue`, which invents an example ("My Document Title")
	 * for an unstored variable - a fresh #1563-class lie in the one place the run
	 * is guaranteed to produce the empty string. And without it, the
	 * output-side {{title}} check above would turn a WORKING choice red.
	 */
	private resolveTitleInIncludedBody(body: string): string {
		if (!TITLE_REGEX.test(body)) return body;
		const title = this.variables.get("title");
		// A function replacer, not a string: a title containing "$&" would
		// otherwise be spliced through String.replace's substitution syntax.
		const resolved = typeof title === "string" ? title : "";
		return body.replace(new RegExp(TITLE_REGEX.source, "gi"), () => resolved);
	}

	/**
	 * A template body is many lines and a file name is one, so the normalizer at
	 * the end of `format()` joins them with spaces - which is what the run does
	 * too, and is therefore the honest preview. But a name assembled out of
	 * someone's whole note template reads as a puzzle, and the preview is the only
	 * thing here that knows those were separate lines.
	 *
	 * Deliberately NOT fired for a body that merely ends in a newline: every
	 * well-formed one-line naming template does, and warning about those would be
	 * the per-keystroke noise #1558 removed.
	 */
	private warnIfJoinedIntoOneLine(templatePath: string, resolved: string): void {
		const lines = resolved.split(/\r?\n/).filter((line) => line.trim());
		if (lines.length < 2) return;
		this.warn(
			`Template "${templatePath}" is ${lines.length} lines; a file name is one line, so they are joined with spaces.`,
		);
	}

	protected getCurrentFileLinkToSection(): string | null {
		// Only reachable for an INCLUDED body (the file-name pass leaves links
		// literal, as the run does). Mirrors FormatDisplayFormatter's static
		// example so the two previews describe the token the same way.
		if (!this.app) return getCurrentFileLinkToSectionPreview(null);
		return getCurrentFileLinkToSectionPreview(
			this.app.workspace.getActiveFile(),
		);
	}

	protected async getSelectedText(): Promise<string> {
		return "selected_text";
	}

	protected async getClipboardContent(): Promise<string> {
		return "clipboard_content";
	}

	protected async suggestForField(
		_variableName: string,
		parsed: { fieldName: string },
	): Promise<string> {
		return fileNameSafeStandIn(fieldValuePreview(parsed), "field_value");
	}

	protected suggestForFile(parsed: ParsedFileToken): string {
		// Preview: show a representative real file, else a placeholder. Never prompt.
		const files = this.app
			? EnhancedFieldSuggestionFileFilter.filterFiles(
					this.app.vault.getMarkdownFiles(),
					parsed.filter,
					(file) => this.app!.metadataCache.getFileCache(file),
				)
			: [];
		if (files.length > 0) return `${FILE_PICK_PREFIX}${files[0].path}`;
		return `${FILE_CUSTOM_PREFIX}${parsed.folderPath || "file"}`;
	}

	protected async replaceDateVariableInString(input: string): Promise<string> {
		let output: string = input;

		// The date only. FormatDisplayFormatter appends " (default: X)" /
		// " (optional)" hints about the token; this row is a FILE NAME, and the
		// run splices in the formatted date and nothing else - so a hint here
		// asserted a name that could never be created, which is the whole point
		// of #1563/#1578. The hints survive where they are true: on the body
		// preview, and in the run's own prompt placeholder ("Enter value for due
		// (default: tomorrow)"). Like the body preview, this renders the current
		// date WITHOUT applying |startof:/|endof: snap - snap is only resolved in
		// the real CompleteFormatter pass, and snapping only the file-name
		// preview would diverge from the body preview.
		output = output.replace(new RegExp(DATE_VARIABLE_REGEX.source, 'gi'), (match, variableName, dateFormat, rawOptions) => {
			const cleanVariableName = variableName?.trim();

			// Only a NAMELESS token stays literal, which is what the run does with
			// it too. A token that names no FORMAT is complete and working - the
			// run supplies YYYY-MM-DD, or YYYY-MM-DD HH:mm under |time - so
			// echoing it back promised a name with a token in it (#1589).
			if (!cleanVariableName) {
				return match;
			}

			const { options, error } = parseVDateOptionsForPreview(rawOptions);
			// A unit that never resolves is an authoring mistake the run aborts on,
			// so it belongs on the diagnostics channel (held back until the field is
			// idle) rather than being swallowed. The options still come back usable,
			// so the TEXT does not flicker while the unit is being typed.
			if (error) this.reportProblem(error);
			const { withTime, snap, caseStyle } = options;
			const cleanDateFormat =
				dateFormat?.trim() || defaultDateVariableFormat(withTime);

			// An ANSWERED date wins over the example. The one-page input form
			// seeds the user's real picks into this formatter before computing the
			// preview (runOnePagePreflight.computePreview), so without this the row
			// showed today's date beside the date they had just chosen (#1590).
			const stored = renderStoredDateVariable(
				this.variables.get(cleanVariableName),
				cleanDateFormat,
				snap,
				this.dateParser,
			);
			if (stored) return this.applyCaseOption(stored.text, caseStyle, match);

			// Nothing answered: a realistic example from the current date, snapped
			// the way the run snaps it. #1595 deliberately left snap out of this
			// preview, on the grounds that snapping only the file-name row would
			// split it from the body row - both rows do it now, so that reason is
			// gone, and the alternative was worse: the ANSWERED branch above snaps
			// (it is the run's own renderer), and {{DATE:...|startof:month}} in the
			// very same pass has always snapped, so the row contradicted itself
			// depending on which token you used. Inside the try, because the snap
			// needs moment and a throw here would redden the row per keystroke.
			try {
				return this.applyCaseOption(
					DateFormatPreviewGenerator.generate(
						cleanDateFormat,
						snappedExampleDate(snap),
					),
					caseStyle,
					match,
				);
			} catch {
				return `[${cleanDateFormat}]`;
			}
		});

		return output;
	}

	protected replaceRandomInString(input: string): string {
		let output = input;
		
		// Replace {{RANDOM:n}} with a preview showing example output
		output = output.replace(/{{RANDOM:(\d+)}}/gi, (match, length) => {
			const len = parseInt(length);
			if (len <= 0 || len > 100) {
				return match; // Return original if invalid
			}
			
			// For filename preview, show a simple example
			const exampleChars = 'ABC123';
			let preview = '';
			for (let i = 0; i < Math.min(len, 6); i++) {
				preview += exampleChars.charAt(i % exampleChars.length);
			}
			
			// For long strings, show ellipsis
			if (len > 6) {
				preview += '...';
			}
			
			return preview;
		});
		
		return output;
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false; // Not applicable for filename display
	}
}
