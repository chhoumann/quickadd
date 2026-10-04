import type { App, TAbstractFile } from "obsidian";
import { Notice, TFile } from "obsidian";
import {
	JAVASCRIPT_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../constants";
import type { IUserScript } from "../types/macros/IUserScript";
import { extractScriptFromMarkdown } from "./extractScriptFromMarkdown";
import { reportError } from "./errorUtils";

type GetUserScriptOptions = {
	reportLoadErrors?: boolean;
};

const HTML_PREFIX_LENGTH = 1024;

class UserScriptLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserScriptLoadError";
	}
}

export function isUserScriptLoadError(error: unknown): error is Error {
	return error instanceof UserScriptLoadError;
}

function stripByteOrderMark(value: string): string {
	return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function getLeadingScriptText(source: string): string {
	return stripByteOrderMark(source)
		.trimStart()
		.slice(0, HTML_PREFIX_LENGTH)
		.toLowerCase();
}

function looksLikeHtmlPayload(source: string): boolean {
	return /^<(?:!doctype\s+html|html\b|head\b|body\b|script\b|meta\b|title\b|div\b)/.test(
		getLeadingScriptText(source),
	);
}

function reportAndThrowUserScriptLoadError(
	message: string,
	options: GetUserScriptOptions,
): never {
	const error = new UserScriptLoadError(message);
	if (options.reportLoadErrors !== false) {
		// reportError, not log.logError: this error is thrown straight past
		// MacroChoiceEngine's own reporting catch and lands in the command-palette
		// handler, which reported it a second time - two stacked 15-second notices with
		// the same 300-character message for one typo'd require (#1601).
		reportError(error);
	}

	throw error;
}

function unsupportedScriptFileMessage(path: string): string {
	return `QuickAdd could not run ${path}. A user script must be a .js file or a note with a \`\`\`js code block. Rename the file so it ends in .js.`;
}

function missingScriptMessage(path: string): string {
	return `QuickAdd could not find ${path}. If you moved or renamed the script, update its path in the macro.`;
}

function savedWebpageMessage(path: string): string {
	return `QuickAdd could not load ${path}. This file looks like a saved webpage, not a JavaScript file. Open the script on GitHub, use the Raw button, then download the .js file and select that file in QuickAdd.`;
}

function defaultExportMessage(path: string): string {
	return `QuickAdd loaded ${path}, but its default export is not a function. Change it to module.exports = async (params) => { ... } or exports.default = async (params) => { ... }. If you meant to export several functions, use module.exports = { run } and select Script::run.`;
}

function missingModuleMessage(path: string, moduleName: string | undefined): string {
	const missing = moduleName
		? `the required module "${moduleName}"`
		: "a required module";
	return `QuickAdd could not load ${path} because it could not find ${missing}. Check that the required file or package exists, and that the capitalization in require(...) matches the file name exactly.`;
}

function syntaxErrorMessage(
	path: string,
	message: string,
	line: number | undefined,
): string {
	const where = line === undefined ? "" : ` on line ${line}`;
	return `QuickAdd could not load ${path} because it has a syntax error${where}: ${message}. Fix the script and run it again.`;
}

const USER_SCRIPT_PARAMETERS = ["require", "module", "exports"];

type NodeVm = {
	compileFunction(code: string, params: string[], options: { filename: string }): unknown;
};

/**
 * `new Function` reports a syntax error without its position. On desktop, Node's
 * `vm` compiles the same source and starts the error stack with `<filename>:<line>`.
 * The two parsers differ in places: `vm` accepts a leading shebang line and
 * `new Function` does not. The line is only trusted when `vm` failed with the
 * same message, so it never points at a different error than the one reported.
 * Mobile has no `require`, so the error there names the file but not the line.
 */
function getSyntaxErrorLine(source: string, message: string): number | undefined {
	const vm = window.require?.("vm") as NodeVm | undefined;
	try {
		vm?.compileFunction(source, USER_SCRIPT_PARAMETERS, { filename: "user-script" });
	} catch (error) {
		if (!(error instanceof Error) || error.message !== message) return undefined;
		const line = error.stack?.match(/^user-script:(\d+)\n/)?.[1];
		if (line) return Number(line);
	}
	return undefined;
}

function getMissingModuleName(error: unknown): string | undefined {
	if (!isMissingModuleError(error)) return undefined;

	const message = error instanceof Error ? error.message : String(error);
	return message.match(/Cannot find module ['"]([^'"]+)['"]/)?.[1];
}

function isMissingModuleError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;

	const code = (error as { code?: unknown }).code;
	if (code === "MODULE_NOT_FOUND") return true;

	const message = error instanceof Error ? error.message : String(error);
	return message.includes("Cannot find module");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function hasRunnableObjectMember(value: Record<string, unknown>): boolean {
	if (typeof value.entry === "function") return true;

	return Object.entries(value).some(
		([key, member]) =>
			key !== "settings" &&
			key !== "quickadd" &&
			typeof member === "function",
	);
}

function isRunnableUserScriptExport(value: unknown): boolean {
	if (typeof value === "function") return true;
	if (!isRecord(value)) return false;

	return hasRunnableObjectMember(value);
}

export function getUserScriptMemberAccess(fullMemberPath: string): {
	basename: string | undefined;
	memberAccess: string[] | undefined;
} {
	// Use "::" exclusively to separate macro/script from member path
	const parts = fullMemberPath
		.split("::")
		.map(p => p.trim())
		.filter(Boolean);

	return {
		basename: parts[0],
		memberAccess: parts.slice(1)
	};
}

/**
 * Cache key for a preloaded user script (the map shared between the
 * requirement collector and MacroChoiceEngine; values are
 * {@link LoadedUserScript}). It must include the `::` member drill from
 * `command.name`, because the cached `script` is the DRILLED value: two
 * commands sharing one path but drilling different members (`lib::foo` vs
 * `lib::bar`) hold different functions and must never consume each other's
 * preloaded entry.
 */
export function getUserScriptPreloadKey(
	command: IUserScript,
): string | undefined {
	const base = command.path ?? command.id;
	if (base === undefined) return undefined;
	const { memberAccess } = getUserScriptMemberAccess(command.name ?? "");
	return memberAccess && memberAccess.length > 0
		? `${base}::${memberAccess.join("::")}`
		: base;
}

/**
 * A loaded user script: `script` is the value selected by the `::` member
 * drill in `command.name` (what runs), and `settings` is the script's settings
 * definition. The definition belongs to the module, not to the drilled
 * export: `Script::Export` usually drills to a bare function, while
 * `settings` lives on `module.exports`. So `settings` is taken from the
 * nearest value along the drill path - the drilled export itself first, then
 * each parent, ending at the module root - that exports a `settings` object.
 */
export type LoadedUserScript = {
	script: unknown;
	settings: Record<string, unknown> | undefined;
};

function getOwnSettingsDefinition(
	value: unknown,
): Record<string, unknown> | undefined {
	if (!isRecord(value) && typeof value !== "function") return undefined;
	const settings = (value as { settings?: unknown }).settings;
	return isRecord(settings) ? settings : undefined;
}

export function selectUserScriptMember(
	moduleExports: unknown,
	memberAccess: readonly string[],
): LoadedUserScript {
	let script = moduleExports;
	let settings = getOwnSettingsDefinition(script);
	for (const member of memberAccess) {
		// Untyped CommonJS exports: a missing intermediate member throws, as before.
		script = (script as Record<string, unknown>)[member];
		settings = getOwnSettingsDefinition(script) ?? settings;
	}
	return { script, settings };
}

/** The drilled export only; use {@link loadUserScript} when settings matter. */
export async function getUserScript(
	command: IUserScript,
	app: App,
	options: GetUserScriptOptions = {},
) {
	return (await loadUserScript(command, app, options))?.script;
}

// Slightly modified version of Templater's user script import implementation
// Source: https://github.com/SilentVoid13/Templater
export async function loadUserScript(
	command: IUserScript,
	app: App,
	options: GetUserScriptOptions = {},
): Promise<LoadedUserScript | undefined> {
	// @ts-ignore
	const file: TAbstractFile = app.vault.getAbstractFileByPath(command.path);
	if (!file) {
		reportAndThrowUserScriptLoadError(missingScriptMessage(command.path), options);
	}

	if (file instanceof TFile) {
		const isNote = MARKDOWN_FILE_EXTENSION_REGEX.test(file.path);
		// Code runs only from .js files and notes, the same files the script
		// pickers offer and the package import review asks you to read.
		if (!isNote && !JAVASCRIPT_FILE_EXTENSION_REGEX.test(file.path)) {
			reportAndThrowUserScriptLoadError(
				unsupportedScriptFileMessage(command.path),
				options,
			);
		}

		const req = (s: string) => window.require && window.require(s);
		const exp: Record<string, unknown> = {};
		const mod = { exports: exp };

		const fileContent = await app.vault.read(file);

		// A user script can live in a `.js` file OR inside a ```js fenced code block
		// in a note (#1065) — the latter is editable on mobile. For a note we run the
		// first js fence and ignore surrounding prose; the .js path is byte-identical.
		let scriptSource = fileContent;
		if (isNote) {
			const { code, error } = extractScriptFromMarkdown(fileContent);
			if (code === null || code.length === 0) {
				// Surface a visible, actionable reason (the caller's generic "failed to
				// load" log alone is easy to miss) and fall through to the established
				// "return undefined" contract — do not double-log here.
				if (options.reportLoadErrors !== false) {
					new Notice(`QuickAdd: ${error} (${command.path})`);
				}
				return;
			}
			scriptSource = code;
		}

		// User scripts are CommonJS modules. Wrap the file body in a Function whose
		// parameters are the module globals, instead of `eval`-ing a wrapper string.
		// This executes the (trusted, user-authored) script identically to the
		// previous `(function(require, module, exports){ ... })` eval form.
		if (looksLikeHtmlPayload(scriptSource)) {
			reportAndThrowUserScriptLoadError(
				savedWebpageMessage(command.path),
				options,
			);
		}

		let fn: (...args: unknown[]) => unknown;
		try {
			fn = new Function(...USER_SCRIPT_PARAMETERS, scriptSource) as typeof fn;
		} catch (error) {
			if (error instanceof SyntaxError) {
				reportAndThrowUserScriptLoadError(
					syntaxErrorMessage(
						command.path,
						error.message,
						getSyntaxErrorLine(scriptSource, error.message),
					),
					options,
				);
			}

			throw error;
		}

		try {
			fn(req, mod, exp);
		} catch (error) {
			if (isMissingModuleError(error)) {
				reportAndThrowUserScriptLoadError(
					missingModuleMessage(
						command.path,
						getMissingModuleName(error),
					),
					options,
				);
			}

			throw error;
		}

		// @ts-ignore
		const userScript = exp["default"] || mod.exports;
		if (!userScript) return;

		const usesExplicitDefaultExport = Boolean(exp["default"]);

		const memberAccess = getUserScriptMemberAccess(command.name).memberAccess ?? [];
		const loaded = selectUserScriptMember(userScript, memberAccess);

		if (
			usesExplicitDefaultExport &&
			memberAccess.length === 0 &&
			!isRunnableUserScriptExport(loaded.script)
		) {
			reportAndThrowUserScriptLoadError(
				defaultExportMessage(command.path),
				options,
			);
		}

		return loaded;
	}
}
