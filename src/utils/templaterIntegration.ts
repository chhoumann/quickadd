import { MarkdownView, type App, type TFile } from "obsidian";
import { log } from "../logger/logManager";
import { reportError } from "./errorUtils";

export type TemplaterPluginLike = {
	settings?: {
		trigger_on_file_creation?: boolean;
		auto_jump_to_cursor?: boolean;
	};
	templater?: {
		overwrite_file_commands?: (f: TFile) => Promise<void>;
		parse_template?: (
			opt: { target_file: TFile; run_mode: number; frontmatter?: Record<string, unknown> },
			content: string,
		) => Promise<string>;
		create_running_config?: (
			template_file: TFile | undefined,
			target_file: TFile,
			run_mode: number,
		) => { target_file: TFile; run_mode: number; frontmatter: Record<string, unknown> };
		files_with_pending_templates?: Set<string>;
		functions_generator?: { teardown?: () => Promise<void> };
	};
	editor_handler?: {
		plugin?: unknown;
		jump_to_next_cursor_location?: (
			file?: TFile | null,
			auto_jump?: boolean,
		) => Promise<void>;
	};
};

type CursorSnapshot = {
	line: number;
	ch: number;
};

function getActiveEditorCursorSnapshot(
	app: App,
	file: TFile,
): CursorSnapshot | null {
	try {
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || view.file?.path !== file.path) return null;

		const cursor = view.editor?.getCursor?.();
		if (
			!cursor ||
			typeof cursor.line !== "number" ||
			typeof cursor.ch !== "number"
		) {
			return null;
		}

		return { line: cursor.line, ch: cursor.ch };
	} catch {
		return null;
	}
}

function didCursorMove(
	before: CursorSnapshot | null,
	after: CursorSnapshot | null,
): boolean {
	return (
		before !== null &&
		after !== null &&
		(before.line !== after.line || before.ch !== after.ch)
	);
}

/**
 * Wait until the filesystem reports a stable mtime for the file or the timeout elapses.
 * This removes the need for an arbitrary debounce (e.g., 75 ms) and is resilient across
 * local SSDs, network shares, and different OSes.
 */
export async function waitForFileSettle(app: App, file: TFile, timeoutMs = 500) {
	try {
		const adapter = app.vault.adapter;
		if (!("stat" in adapter) || typeof adapter.stat !== "function") return;

		const firstStat = await adapter.stat(file.path);
		if (!firstStat) return; // Unable to get file info – skip waiting.
		let previousMtime = firstStat.mtime;
		const start = Date.now();

		// Poll with exponential backoff until the mtime is stable or we hit the timeout.
		let pollIntervalMs = 30;
		while (Date.now() - start < timeoutMs) {
			await sleep(pollIntervalMs);
			const current = await adapter.stat(file.path);
			if (!current) return; // stat failed; abort waiting.
			if (current.mtime === previousMtime) return;
			previousMtime = current.mtime;
			// Double the interval if mtime keeps changing (exponential backoff)
			pollIntervalMs = Math.min(pollIntervalMs * 2, 200);
		}
	} catch (err) {
		// Non-fatal – we'll fall back to immediate processing.
		log.logWarning(`waitForFileSettle: fallback due to adapter/stat failure – ${(err as Error).message}`);
	}
}

export function getTemplater(app: App) {
	return app.plugins.plugins["templater-obsidian"];
}

export function getTemplaterPlugin(app: App): TemplaterPluginLike | null {
	const plugin = getTemplater(app);
	if (!plugin) return null;
	return plugin as unknown as TemplaterPluginLike;
}

export function isTemplaterTriggerOnCreateEnabled(app: App): boolean {
	return !!getTemplaterPlugin(app)?.settings?.trigger_on_file_creation;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function waitForTemplaterTriggerOnCreateToComplete(
	app: App,
	file: TFile,
	opts: { timeoutMs?: number; appearTimeoutMs?: number } = {},
): Promise<void> {
	if (file.extension !== "md") return;
	if (!isTemplaterTriggerOnCreateEnabled(app)) return;

	const plugin = getTemplaterPlugin(app);
	const pendingFiles = plugin?.templater?.files_with_pending_templates;
	if (!(pendingFiles instanceof Set)) {
		await waitForFileToStopChanging(app, file, {
			timeoutMs: opts.timeoutMs ?? 5000,
			gracePeriodMs: opts.appearTimeoutMs ?? 2500,
			quietPeriodMs: 200,
		});
		return;
	}

	const { timeoutMs = 5000, appearTimeoutMs = 2500 } = opts;
	const start = Date.now();

	while (Date.now() - start < appearTimeoutMs) {
		if (pendingFiles.has(file.path)) break;
		await sleep(50);
	}

	while (Date.now() - start < timeoutMs) {
		if (!pendingFiles.has(file.path)) break;
		await sleep(50);
	}

	await waitForFileSettle(app, file, 800);
}

type TemplaterFileCreationSuppressionState = {
	count: number;
	hadPathInitially: boolean;
};

const templaterFileCreationSuppressions = new Map<
	string,
	TemplaterFileCreationSuppressionState
>();
let activeTemplaterFileCreationSuppressions = 0;
let templaterSuppressionTeardownLock: Promise<void> | null = null;

// Templater waits ~300ms before checking `files_with_pending_templates` in its
// on-create handler. We hold the entry slightly longer to ensure the bypass is
// observed.
// Tested with templater-obsidian v2.x; may need adjustment if Templater internals
// change.
const TEMPLATER_PENDING_CHECK_BUFFER_MS = 350;

async function maybeTeardownTemplaterAfterSuppression(
	app: App,
	plugin: TemplaterPluginLike,
	pendingFiles: Set<string>,
): Promise<void> {
	if (activeTemplaterFileCreationSuppressions > 0) return;
	if (pendingFiles.size !== 0) return;

	if (templaterSuppressionTeardownLock) {
		await templaterSuppressionTeardownLock;
		return;
	}

	templaterSuppressionTeardownLock = (async () => {
		try {
			app.workspace.trigger("templater:all-templates-executed");
			await plugin.templater?.functions_generator?.teardown?.();
		} catch (err) {
			log.logWarning(
				`withTemplaterFileCreationSuppressed: teardown failed – ${(err as Error).message}`,
			);
		}
	})();

	try {
		await templaterSuppressionTeardownLock;
	} finally {
		templaterSuppressionTeardownLock = null;
	}
}

export async function withTemplaterFileCreationSuppressed<T>(
	app: App,
	filePath: string,
	fn: () => Promise<T>,
): Promise<T> {
	const plugin = getTemplaterPlugin(app);
	const pendingFiles = plugin?.templater?.files_with_pending_templates;
	if (
		!plugin ||
		!isTemplaterTriggerOnCreateEnabled(app) ||
		!(pendingFiles instanceof Set)
	) {
		return await fn();
	}

	activeTemplaterFileCreationSuppressions++;

	let state = templaterFileCreationSuppressions.get(filePath);
	if (!state) {
		state = {
			count: 0,
			hadPathInitially: pendingFiles.has(filePath),
		};
		templaterFileCreationSuppressions.set(filePath, state);

		if (!state.hadPathInitially) {
			pendingFiles.add(filePath);
		}
	}

	state.count++;

	let fnSucceeded = false;
	try {
		const result = await fn();
		fnSucceeded = true;
		return result;
	} finally {
		state.count--;
		activeTemplaterFileCreationSuppressions--;

		if (state.count <= 0) {
			templaterFileCreationSuppressions.delete(filePath);

			if (!state.hadPathInitially) {
				if (fnSucceeded) {
					const minHoldMs = TEMPLATER_PENDING_CHECK_BUFFER_MS;
					await sleep(minHoldMs);
				}

				pendingFiles.delete(filePath);

				// By temporarily adding entries to Templater's internal Set, we can
				// prevent its own teardown from firing when other tasks finish.
				// When the Set is empty again (and no suppressions are active),
				// emulate the "all templates executed" teardown to avoid leaving
				// internal state around.
				await maybeTeardownTemplaterAfterSuppression(app, plugin, pendingFiles);
			}
		}
	}
}

export async function waitForFileToStopChanging(
	app: App,
	file: TFile,
	opts: {
		timeoutMs?: number;
		quietPeriodMs?: number;
		gracePeriodMs?: number;
	} = {},
): Promise<void> {
	const {
		timeoutMs = 2000,
		quietPeriodMs = 150,
		gracePeriodMs = 800,
	} = opts;

	try {
		const adapter = app.vault.adapter;
		if (!("stat" in adapter) || typeof adapter.stat !== "function") return;

		const firstStat = await adapter.stat(file.path);
		if (!firstStat) return;

		let lastMtime = firstStat.mtime;
		let lastChangeAt = Date.now();
		let sawExternalChange = false;
		const start = lastChangeAt;

		let pollIntervalMs = 50;
		while (Date.now() - start < timeoutMs) {
			await sleep(pollIntervalMs);
			const current = await adapter.stat(file.path);
			if (!current) return;

			const now = Date.now();
			if (current.mtime !== lastMtime) {
				sawExternalChange = true;
				lastMtime = current.mtime;
				lastChangeAt = now;
				pollIntervalMs = 50;
				continue;
			}

			if (sawExternalChange) {
				if (now - lastChangeAt >= quietPeriodMs) return;
			} else {
				if (now - start >= gracePeriodMs) return;
			}

			pollIntervalMs = Math.min(Math.floor(pollIntervalMs * 1.5), 200);
		}
	} catch (err) {
		log.logWarning(
			`waitForFileToStopChanging: fallback due to adapter/stat failure – ${(err as Error).message}`,
		);
	}
}

const templaterRenderLocks = new Map<string, Promise<void>>();

async function withTemplaterFileLock<T>(
	filePath: string,
	fn: () => Promise<T>,
): Promise<T> {
	const previous = templaterRenderLocks.get(filePath) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolve) => {
		release = () => resolve();
	});

	const chain = previous
		.catch(() => undefined)
		.then(() => current);

	templaterRenderLocks.set(filePath, chain);

	chain
		.finally(() => {
			if (templaterRenderLocks.get(filePath) === chain) {
				templaterRenderLocks.delete(filePath);
			}
		})
		.catch(() => undefined);

	await previous.catch(() => undefined);
	try {
		return await fn();
	} finally {
		release();
	}
}

export async function overwriteTemplaterOnce(
	app: App,
	file: TFile,
	opts: { skipIfNoTags?: boolean; postWait?: boolean } = {},
): Promise<void> {
	if (file.extension !== "md") return;

	const plugin = getTemplaterPlugin(app);
	const templater = plugin?.templater;
	const overwrite = templater?.overwrite_file_commands;
	if (!plugin || !templater || typeof overwrite !== "function") return;

	const { skipIfNoTags = true, postWait = true } = opts;

	await withTemplaterFileLock(file.path, async () => {
		// Ensure the initial QuickAdd write is flushed & stable on disk.
		await waitForFileSettle(app, file);

		let original: string;
		try {
			original = await app.vault.read(file);
		} catch (err) {
			reportError(
				err as Error,
				`overwriteTemplaterOnce: failed to read ${file.path} before render`,
			);
			return;
		}

		if (skipIfNoTags && !original.includes("<%")) {
			return;
		}

		try {
			// Preserve Templater's internal `this` context.
			await overwrite.call(templater, file);
			if (postWait) {
				await waitForFileSettle(app, file, 800);
			}
		} catch (err) {
			// Roll back to original content to avoid partial renders
			try {
				await app.vault.modify(file, original);
			} catch (rollbackErr) {
				log.logWarning(
					`Failed to rollback ${file.path} after Templater error: ${(rollbackErr as Error).message}`,
				);
			}
			reportError(
				err as Error,
				`Templater failed on ${file.path}. Rolled back to pre-render state.`,
			);
		}
	});
}

export async function templaterParseTemplate(
	app: App,
	templateContent: string,
	targetFile: TFile,
) {
	if (targetFile.extension !== "md") return templateContent;

	const plugin = getTemplaterPlugin(app);
	const templater = plugin?.templater;
	const parseTemplate = templater?.parse_template;
	if (!plugin || !templater || typeof parseTemplate !== "function")
		return templateContent;

	// Use Templater's create_running_config if available for forward compatibility.
	// This ensures we get a properly initialized config object with all required fields,
	// even if Templater adds new required fields in future versions.
	// Fallback to manual config for older Templater versions.
	const createConfig = templater.create_running_config;
	const config =
		typeof createConfig === "function"
			? createConfig.call(templater, undefined, targetFile, 4)
			: // `run_mode: 4` = RunMode.DynamicProcessor
			// `frontmatter: {}` required since Templater 2.18.0
			{ target_file: targetFile, run_mode: 4, frontmatter: {} };

	return await parseTemplate.call(templater, config, templateContent);
}

export async function jumpToNextTemplaterCursorIfPossible(
	app: App,
	file: TFile,
): Promise<boolean> {
	if (file.extension !== "md") return false;
	if (app.workspace.getActiveFile()?.path !== file.path) return false;

	const plugin = getTemplaterPlugin(app);
	const autoJumpEnabled = !!plugin?.settings?.auto_jump_to_cursor;
	const editorHandler = plugin?.editor_handler;
	const jump = editorHandler?.jump_to_next_cursor_location;

	if (!autoJumpEnabled) return false;
	const beforeCursor = getActiveEditorCursorSnapshot(app, file);

	if (typeof jump === "function") {
		try {
			// Preserve Templater's internal `this` context.
			await jump.call(editorHandler, file, true);
			return didCursorMove(
				beforeCursor,
				getActiveEditorCursorSnapshot(app, file),
			);
		} catch (err) {
			log.logWarning(
				`jumpToNextTemplaterCursorIfPossible: API failed – ${(err as Error).message}`,
			);
		}
	}

	try {
		const commandRan = !!(
			app.commands as unknown as {
				executeCommandById?: (commandId: string) => boolean;
			}
		).executeCommandById?.(
			"templater-obsidian:jump-to-next-cursor-location",
		);
		if (!commandRan) return false;
		return didCursorMove(
			beforeCursor,
			getActiveEditorCursorSnapshot(app, file),
		);
	} catch {
		// no-op
	}
	return false;
}
