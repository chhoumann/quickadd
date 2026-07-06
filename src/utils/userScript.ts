import type { App, TAbstractFile } from "obsidian";
import { Notice, TFile } from "obsidian";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
import { log } from "../logger/logManager";
import type { IUserScript } from "../types/macros/IUserScript";
import { extractScriptFromMarkdown } from "./extractScriptFromMarkdown";

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
		log.logError(error);
	}

	throw error;
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
 * Cache key for a preloaded user-script module (the map shared between the
 * requirement collector and MacroChoiceEngine). It must include the `::`
 * member drill from `command.name`, because getUserScript returns the
 * DRILLED value: two commands sharing one path but drilling different
 * members (`lib::foo` vs `lib::bar`) hold different functions and must
 * never consume each other's preloaded entry.
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

// Slightly modified version of Templater's user script import implementation
// Source: https://github.com/SilentVoid13/Templater
export async function getUserScript(
	command: IUserScript,
	app: App,
	options: GetUserScriptOptions = {},
) {
	// @ts-ignore
	const file: TAbstractFile = app.vault.getAbstractFileByPath(command.path);
	if (!file) {
		log.logError(`failed to load file ${command.path}.`);
		return;
	}

	if (file instanceof TFile) {

		const req = (s: string) => window.require && window.require(s);
		const exp: Record<string, unknown> = {};
		const mod = { exports: exp };

		const fileContent = await app.vault.read(file);

		// A user script can live in a `.js` file OR inside a ```js fenced code block
		// in a note (#1065) — the latter is editable on mobile. For a note we run the
		// first js fence and ignore surrounding prose; the .js path is byte-identical.
		let scriptSource = fileContent;
		if (MARKDOWN_FILE_EXTENSION_REGEX.test(file.path)) {
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

		try {
			const fn = new Function("require", "module", "exports", scriptSource);

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

		let script = userScript;
		const usesExplicitDefaultExport = Boolean(exp["default"]);

		const { memberAccess } = getUserScriptMemberAccess(command.name);
		const hasMemberAccess = Boolean(memberAccess && memberAccess.length > 0);
		if (memberAccess && memberAccess.length > 0) {
			let member: string;
			while ((member = memberAccess.shift() as string)) {
				//@ts-ignore

				script = script[member];
			}
		}

		if (
			usesExplicitDefaultExport &&
			!hasMemberAccess &&
			!isRunnableUserScriptExport(script)
		) {
			reportAndThrowUserScriptLoadError(
				defaultExportMessage(command.path),
				options,
			);
		}

		return script;
	}
}
