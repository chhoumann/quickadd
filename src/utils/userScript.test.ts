import { Notice, type App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { getUserScript, loadUserScript } from "./userScript";
import type { IUserScript } from "../types/macros/IUserScript";
import { CommandType } from "../types/macros/CommandType";
import { log } from "../logger/logManager";

function createFile(path = "target.md"): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.extension = path.split(".").pop() ?? "";
	file.basename = file.name.replace(/\.[^.]+$/, "");
	return file;
}

describe("getUserScript", () => {
	function noticeMessages(): string[] {
		return (Notice as unknown as { instances: Array<{ message: string }> })
			.instances.map((notice) => notice.message);
	}

	function createUserScriptCommand(
		options: Partial<IUserScript> = {},
	): IUserScript {
		return {
			id: "script",
			name: "Script",
			type: CommandType.UserScript,
			path: "Scripts/script.js",
			settings: {},
			...options,
		};
	}

	function createUserScriptApp(
		fileContent: string,
		path = "Scripts/script.js",
	) {
		const file = createFile(path);
		return {
			vault: {
				getAbstractFileByPath: vi.fn(() => file),
				read: vi.fn(async () => fileContent),
			},
		} as unknown as App;
	}

	it("executes CommonJS user scripts with Obsidian globals available", async () => {
		const app = createUserScriptApp(`
			module.exports = {
				globalType: typeof globalThis,
				globalValue: globalThis.__quickAddEvalCompatibilityGlobal,
			};
		`);
		const previousGlobal = (
			globalThis as { __quickAddEvalCompatibilityGlobal?: string }
		).__quickAddEvalCompatibilityGlobal;
		(
			globalThis as { __quickAddEvalCompatibilityGlobal?: string }
		).__quickAddEvalCompatibilityGlobal = "visible";

		try {
			const script = await getUserScript(createUserScriptCommand(), app);

			expect(script).toEqual({
				globalType: "object",
				globalValue: "visible",
			});
		} finally {
			if (previousGlobal === undefined) {
				delete (
					globalThis as { __quickAddEvalCompatibilityGlobal?: string }
				).__quickAddEvalCompatibilityGlobal;
			} else {
				(
					globalThis as { __quickAddEvalCompatibilityGlobal?: string }
				).__quickAddEvalCompatibilityGlobal = previousGlobal;
			}
		}
	});

	it("preserves argument passing, return values, sensitive strings, and async errors", async () => {
		const app = createUserScriptApp(`
			module.exports = {
				settings: { mode: "private" },
				run: async (params, settings) => {
					if (params.shouldReject) throw new Error("script rejected");
					return {
						receivedToken: params.token,
						mode: settings.mode,
					};
				},
			};
		`);
		const command = createUserScriptCommand({
			name: "Script::run",
			settings: { mode: "user" },
		});

		const script = await getUserScript(command, app);
		expect(typeof script).toBe("function");

		await expect(
			(script as (params: unknown, settings: Record<string, unknown>) => unknown)(
				{ token: "sensitive-token" },
				command.settings,
			),
		).resolves.toEqual({
			receivedToken: "sensitive-token",
			mode: "user",
		});

		await expect(
			(script as (params: unknown, settings: Record<string, unknown>) => unknown)(
				{ shouldReject: true },
				command.settings,
			),
		).rejects.toThrow("script rejected");
	});

	// `Script::Export` drills to what runs, but the settings definition belongs
	// to the module; the gear and execution both read it from here.
	describe("loadUserScript settings definition", () => {
		const rootSettings = { options: { Token: { type: "secret" } } };

		it("reads settings from the module root when the drilled export has none", async () => {
			const app = createUserScriptApp(`
				module.exports = {
					settings: ${JSON.stringify(rootSettings)},
					Export: async () => "ran",
				};
			`);

			const loaded = await loadUserScript(
				createUserScriptCommand({ name: "Script::Export" }),
				app,
			);

			expect(typeof loaded?.script).toBe("function");
			expect(loaded?.settings).toEqual(rootSettings);
		});

		it("prefers the nearest settings along the drill path", async () => {
			const app = createUserScriptApp(`
				module.exports = {
					settings: ${JSON.stringify(rootSettings)},
					group: {
						settings: { options: { Nested: { type: "text" } } },
						run: () => "ran",
					},
				};
			`);

			const nested = await loadUserScript(
				createUserScriptCommand({ name: "Script::group::run" }),
				app,
			);
			const group = await loadUserScript(
				createUserScriptCommand({ name: "Script::group" }),
				app,
			);

			expect(nested?.settings).toEqual({ options: { Nested: { type: "text" } } });
			expect(group?.settings).toEqual({ options: { Nested: { type: "text" } } });
		});

		it("reads settings attached to a function export and ignores non-object settings", async () => {
			const functionRoot = await loadUserScript(
				createUserScriptCommand(),
				createUserScriptApp(`
					const run = () => "ran";
					run.settings = ${JSON.stringify(rootSettings)};
					module.exports = run;
				`),
			);
			const primitiveSettings = await loadUserScript(
				createUserScriptCommand({ name: "Script::run" }),
				createUserScriptApp(`module.exports = { settings: "nope", run: () => 1 };`),
			);

			expect(functionRoot?.settings).toEqual(rootSettings);
			expect(primitiveSettings?.settings).toBeUndefined();
			expect(typeof primitiveSettings?.script).toBe("function");
		});
	});

	it("loads a user script from a note's ```js code block (#1065)", async () => {
		const app = createUserScriptApp(
			[
				"# My script note",
				"",
				"Some prose that should be ignored.",
				"",
				"```js",
				'module.exports = () => "hi from a note";',
				"```",
				"",
				"More prose.",
			].join("\n"),
			"Scripts/note-script.md",
		);
		const command = createUserScriptCommand({
			path: "Scripts/note-script.md",
			name: "note-script",
		});

		const script = await getUserScript(command, app);
		expect(typeof script).toBe("function");
		expect((script as () => unknown)()).toBe("hi from a note");
	});

	it("explains when a .js file is a saved webpage instead of raw JavaScript", async () => {
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const app = createUserScriptApp(
			[
				"<!DOCTYPE html>",
				"<html>",
				"<body>GitHub page, not raw JavaScript.</body>",
				"</html>",
			].join("\n"),
		);

		try {
			await expect(getUserScript(createUserScriptCommand(), app)).rejects.toThrow(
				"saved webpage",
			);

			expect(logError).toHaveBeenCalledTimes(1);
			const reported = logError.mock.calls[0][0] as Error;
			expect(reported.message).toContain("use the Raw button");
			expect(reported.message).toContain("download the .js file");
		} finally {
			logError.mockRestore();
		}
	});

	it("runs only .js files and notes, and says how to fix any other file (#1881)", async () => {
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const source = "module.exports = () => 'ran';";
		try {
			for (const path of ["Scripts/dashboard.base", "Scripts/helper.txt", "Scripts/helper"]) {
				const app = createUserScriptApp(source, path);
				await expect(
					getUserScript(createUserScriptCommand({ path }), app),
				).rejects.toThrow(`QuickAdd could not run ${path}`);
				expect(app.vault.read).not.toHaveBeenCalled();
			}
			expect((logError.mock.calls[0][0] as Error).message).toContain(
				"Rename the file so it ends in .js.",
			);

			const upper = await getUserScript(
				createUserScriptCommand({ path: "Scripts/Helper.JS" }),
				createUserScriptApp(source, "Scripts/Helper.JS"),
			);
			expect((upper as () => string)()).toBe("ran");
		} finally {
			logError.mockRestore();
		}
	});

	it("stops with one clear error when the script is missing, such as after a rename", async () => {
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const app = {
			vault: { getAbstractFileByPath: vi.fn(() => null), read: vi.fn() },
		} as unknown as App;
		try {
			await expect(
				getUserScript(createUserScriptCommand({ path: "Scripts/gone.js" }), app),
			).rejects.toThrow("QuickAdd could not find Scripts/gone.js.");
			expect(logError).toHaveBeenCalledTimes(1);
		} finally {
			logError.mockRestore();
		}
	});

	it("can suppress user-facing load reporting during preflight", async () => {
		const before = noticeMessages().length;
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const app = createUserScriptApp("<html><body>not js</body></html>");

		try {
			await expect(
				getUserScript(createUserScriptCommand(), app, {
					reportLoadErrors: false,
				}),
			).rejects.toThrow("saved webpage");

			expect(noticeMessages()).toHaveLength(before);
			expect(logError).not.toHaveBeenCalled();
		} finally {
			logError.mockRestore();
		}
	});

	it("can suppress markdown script load notices during preflight", async () => {
		const before = noticeMessages().length;
		const app = createUserScriptApp(
			[
				"# Script note",
				"",
				"This note has no JavaScript code block.",
			].join("\n"),
			"Scripts/no-code-block.md",
		);

		const script = await getUserScript(
			createUserScriptCommand({
				path: "Scripts/no-code-block.md",
			}),
			app,
			{
				reportLoadErrors: false,
			},
		);

		expect(script).toBeUndefined();
		expect(noticeMessages()).toHaveLength(before);
	});

	it("explains when an explicit default export is not runnable", async () => {
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const app = createUserScriptApp(
			[
				"exports.default = {",
				"  settings: {",
				"    apiKey: { type: 'text', defaultValue: '' },",
				"  },",
				"};",
			].join("\n"),
		);

		try {
			await expect(getUserScript(createUserScriptCommand(), app)).rejects.toThrow(
				"default export is not a function",
			);

			expect(logError).toHaveBeenCalledTimes(1);
			const reported = logError.mock.calls[0][0] as Error;
			expect(reported.message).toContain("module.exports = async");
			expect(reported.message).toContain("exports.default = async");
		} finally {
			logError.mockRestore();
		}
	});

	it("explains module resolution failures while loading a script", async () => {
		const previousRequire = (window as unknown as {
			require?: (moduleName: string) => unknown;
		}).require;
		const logError = vi.spyOn(log, "logError").mockImplementation(() => {});
		const missingModule = new Error("Cannot find module './Helper.js'");
		(missingModule as Error & { code: string }).code = "MODULE_NOT_FOUND";
		(window as unknown as { require?: (moduleName: string) => unknown }).require =
			vi.fn(() => {
				throw missingModule;
			});
		const app = createUserScriptApp(
			[
				"const helper = require('./Helper.js');",
				"module.exports = async () => helper;",
			].join("\n"),
		);

		try {
			await expect(
				getUserScript(createUserScriptCommand(), app),
			).rejects.toThrow("could not find the required module");

			expect(logError).toHaveBeenCalledTimes(1);
			const reported = logError.mock.calls[0][0] as Error;
			expect(reported.message).toContain("./Helper.js");
			expect(reported.message).toContain("capitalization");
		} finally {
			(window as unknown as { require?: (moduleName: string) => unknown }).require =
				previousRequire;
			logError.mockRestore();
		}
	});

	it("resolves ::member access for a note-based script", async () => {
		const app = createUserScriptApp(
			[
				"```js",
				"module.exports = {",
				"  run: async (params) => params.token,",
				"};",
				"```",
			].join("\n"),
			"Scripts/note-script.md",
		);
		const command = createUserScriptCommand({
			path: "Scripts/note-script.md",
			name: "Scripts/note-script.md::run",
		});

		const script = await getUserScript(command, app);
		expect(typeof script).toBe("function");
		await expect(
			(script as (params: unknown) => unknown)({ token: "ok" }),
		).resolves.toBe("ok");
	});

	it("preserves object exports with callable members", async () => {
		const app = createUserScriptApp(
			"module.exports = { run: async () => 'ok' };",
		);

		const script = await getUserScript(createUserScriptCommand(), app);

		expect(script).toEqual({ run: expect.any(Function) });
	});

	it("allows explicit default object exports when member access selects a function", async () => {
		const app = createUserScriptApp(
			"exports.default = { run: async () => 'ok' };",
		);
		const command = createUserScriptCommand({
			name: "Script::run",
		});

		const script = await getUserScript(command, app);

		expect(typeof script).toBe("function");
		await expect((script as () => unknown)()).resolves.toBe("ok");
	});

	it("returns undefined and shows a notice when a note has no ```js block", async () => {
		const noticeStub = Notice as unknown as {
			instances: Array<{ message: string }>;
		};
		const before = noticeStub.instances.length;
		const app = createUserScriptApp(
			"# Just prose\n\nNo code block here.\n",
			"Scripts/no-fence.md",
		);
		const command = createUserScriptCommand({
			path: "Scripts/no-fence.md",
			name: "no-fence",
		});

		const script = await getUserScript(command, app);
		expect(script).toBeUndefined();

		const added = noticeStub.instances.slice(before);
		expect(added).toHaveLength(1);
		expect(added[0].message).toContain("Scripts/no-fence.md");
	});

	it("treats a note fence without module.exports as a non-runnable export", async () => {
		const app = createUserScriptApp(
			"```js\nconst notExported = 1;\n```",
			"Scripts/inline-style.md",
		);
		const command = createUserScriptCommand({
			path: "Scripts/inline-style.md",
			name: "inline-style",
		});

		const script = await getUserScript(command, app);
		// CommonJS contract: a note script must assign module.exports/exports.default.
		// Without it, the export is the empty module object, never a runnable function.
		expect(typeof script).not.toBe("function");
	});
});
