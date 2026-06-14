import type { App, TAbstractFile } from "obsidian";
import { Notice, TFile } from "obsidian";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
import { log } from "../logger/logManager";
import type { IUserScript } from "../types/macros/IUserScript";
import { extractScriptFromMarkdown } from "./extractScriptFromMarkdown";

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

// Slightly modified version of Templater's user script import implementation
// Source: https://github.com/SilentVoid13/Templater
export async function getUserScript(command: IUserScript, app: App) {
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
				new Notice(`QuickAdd: ${error} (${command.path})`);
				return;
			}
			scriptSource = code;
		}

		// User scripts are CommonJS modules. Wrap the file body in a Function whose
		// parameters are the module globals, instead of `eval`-ing a wrapper string.
		// This executes the (trusted, user-authored) script identically to the
		// previous `(function(require, module, exports){ ... })` eval form.
		const fn = new Function("require", "module", "exports", scriptSource);

		fn(req, mod, exp);

		// @ts-ignore
		const userScript = exp["default"] || mod.exports;
		if (!userScript) return;

		let script = userScript;

		const { memberAccess } = getUserScriptMemberAccess(command.name);
		if (memberAccess && memberAccess.length > 0) {
			let member: string;
			while ((member = memberAccess.shift() as string)) {
				//@ts-ignore

				script = script[member];
			}
		}

		return script;
	}
}
