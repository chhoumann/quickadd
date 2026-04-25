import type { App, TFile } from "obsidian";
import { log } from "../logger/logManager";
import { reportError } from "../utils/errorUtils";

export const TEMPLATER_PLUGIN_ID = "templater-obsidian";

export type TemplaterPluginLike = {
	settings?: {
		trigger_on_file_creation?: boolean;
		auto_jump_to_cursor?: boolean;
	};
	templater?: {
		overwrite_file_commands?: (f: TFile) => Promise<void>;
		parse_template?: (
			opt: {
				target_file: TFile;
				run_mode: number;
				frontmatter?: Record<string, unknown>;
			},
			content: string,
		) => Promise<string>;
		create_running_config?: (
			template_file: TFile | undefined,
			target_file: TFile,
			run_mode: number,
		) => {
			target_file: TFile;
			run_mode: number;
			frontmatter: Record<string, unknown>;
		};
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

export type TemplaterCapability =
	| "triggerOnFileCreation"
	| "pendingTemplates"
	| "overwriteFileCommands"
	| "parseTemplate"
	| "createRunningConfig"
	| "cursorAutoJump"
	| "cursorJump"
	| "teardown";

export type TemplaterCapabilityMap = Record<TemplaterCapability, boolean>;

export interface TemplaterCapabilityReport {
	pluginId: typeof TEMPLATER_PLUGIN_ID;
	installed: boolean;
	capabilities: TemplaterCapabilityMap;
	missingCapabilities: TemplaterCapability[];
}

export interface TemplaterIntegration {
	readonly id: typeof TEMPLATER_PLUGIN_ID;
	getRawPlugin(): unknown | null;
	getPlugin(): TemplaterPluginLike | null;
	getCapabilityReport(): TemplaterCapabilityReport;
	hasCapability(capability: TemplaterCapability): boolean;
	isTriggerOnCreateEnabled(): boolean;
	waitForTriggerOnCreateToComplete(
		file: TFile,
		opts?: { timeoutMs?: number; appearTimeoutMs?: number },
	): Promise<void>;
	withFileCreationSuppressed<T>(
		filePath: string,
		fn: () => Promise<T>,
	): Promise<T>;
	overwriteFileOnce(
		file: TFile,
		opts?: { skipIfNoTags?: boolean; postWait?: boolean },
	): Promise<void>;
	parseTemplate(
		templateContent: string,
		targetFile: TFile,
	): Promise<string>;
	jumpToNextCursorIfPossible(file: TFile): Promise<void>;
}

const ALL_CAPABILITIES: TemplaterCapability[] = [
	"triggerOnFileCreation",
	"pendingTemplates",
	"overwriteFileCommands",
	"parseTemplate",
	"createRunningConfig",
	"cursorAutoJump",
	"cursorJump",
	"teardown",
];

const NO_CAPABILITIES = ALL_CAPABILITIES.reduce(
	(capabilities, capability) => {
		capabilities[capability] = false;
		return capabilities;
	},
	{} as TemplaterCapabilityMap,
);

function createReport(
	installed: boolean,
	capabilities: TemplaterCapabilityMap,
): TemplaterCapabilityReport {
	return {
		pluginId: TEMPLATER_PLUGIN_ID,
		installed,
		capabilities,
		missingCapabilities: ALL_CAPABILITIES.filter(
			(capability) => !capabilities[capability],
		),
	};
}

export class NoopTemplaterIntegration implements TemplaterIntegration {
	readonly id = TEMPLATER_PLUGIN_ID;

	getRawPlugin(): null {
		return null;
	}

	getPlugin(): null {
		return null;
	}

	getCapabilityReport(): TemplaterCapabilityReport {
		return createReport(false, { ...NO_CAPABILITIES });
	}

	hasCapability(_capability: TemplaterCapability): boolean {
		return false;
	}

	isTriggerOnCreateEnabled(): boolean {
		return false;
	}

	async waitForTriggerOnCreateToComplete(): Promise<void> {
		return;
	}

	async withFileCreationSuppressed<T>(
		_filePath: string,
		fn: () => Promise<T>,
	): Promise<T> {
		return await fn();
	}

	async overwriteFileOnce(): Promise<void> {
		return;
	}

	async parseTemplate(
		templateContent: string,
		_targetFile: TFile,
	): Promise<string> {
		return templateContent;
	}

	async jumpToNextCursorIfPossible(): Promise<void> {
		return;
	}
}

export class ObsidianTemplaterIntegration implements TemplaterIntegration {
	readonly id = TEMPLATER_PLUGIN_ID;
	private readonly fileCreationSuppressions = new Map<
		string,
		TemplaterFileCreationSuppressionState
	>();
	private activeFileCreationSuppressions = 0;
	private suppressionTeardownLock: Promise<void> | null = null;
	private readonly renderLocks = new Map<string, Promise<void>>();

	constructor(private readonly app: App) {}

	getRawPlugin(): unknown | null {
		return getRawTemplaterPlugin(this.app);
	}

	getPlugin(): TemplaterPluginLike | null {
		const plugin = this.getRawPlugin();
		if (!plugin) return null;
		return plugin as TemplaterPluginLike;
	}

	getCapabilityReport(): TemplaterCapabilityReport {
		const plugin = this.getPlugin();
		if (!plugin) return createReport(false, { ...NO_CAPABILITIES });

		const templater = plugin.templater;
		const editorHandler = plugin.editor_handler;
		const capabilities: TemplaterCapabilityMap = {
			triggerOnFileCreation:
				typeof plugin.settings?.trigger_on_file_creation === "boolean",
			pendingTemplates:
				templater?.files_with_pending_templates instanceof Set,
			overwriteFileCommands:
				typeof templater?.overwrite_file_commands === "function",
			parseTemplate: typeof templater?.parse_template === "function",
			createRunningConfig:
				typeof templater?.create_running_config === "function",
			cursorAutoJump:
				typeof plugin.settings?.auto_jump_to_cursor === "boolean",
			cursorJump:
				typeof editorHandler?.jump_to_next_cursor_location === "function",
			teardown:
				typeof templater?.functions_generator?.teardown === "function",
		};

		return createReport(true, capabilities);
	}

	hasCapability(capability: TemplaterCapability): boolean {
		return this.getCapabilityReport().capabilities[capability];
	}

	isTriggerOnCreateEnabled(): boolean {
		return !!this.getPlugin()?.settings?.trigger_on_file_creation;
	}

	async waitForTriggerOnCreateToComplete(
		file: TFile,
		opts: { timeoutMs?: number; appearTimeoutMs?: number } = {},
	): Promise<void> {
		if (file.extension !== "md") return;
		if (!this.isTriggerOnCreateEnabled()) return;

		const pendingFiles = this.getPlugin()?.templater?.files_with_pending_templates;
		if (!(pendingFiles instanceof Set)) {
			await waitForFileToStopChanging(this.app, file, {
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

		await waitForFileSettle(this.app, file, 800);
	}

	async withFileCreationSuppressed<T>(
		filePath: string,
		fn: () => Promise<T>,
	): Promise<T> {
		const plugin = this.getPlugin();
		const pendingFiles = plugin?.templater?.files_with_pending_templates;
		if (
			!plugin ||
			!this.isTriggerOnCreateEnabled() ||
			!(pendingFiles instanceof Set)
		) {
			return await fn();
		}

		this.activeFileCreationSuppressions++;

		let state = this.fileCreationSuppressions.get(filePath);
		if (!state) {
			state = {
				count: 0,
				hadPathInitially: pendingFiles.has(filePath),
			};
			this.fileCreationSuppressions.set(filePath, state);

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
			this.activeFileCreationSuppressions--;

			if (state.count <= 0) {
				this.fileCreationSuppressions.delete(filePath);

				if (!state.hadPathInitially) {
					if (fnSucceeded) {
						await sleep(TEMPLATER_PENDING_CHECK_BUFFER_MS);
					}

					pendingFiles.delete(filePath);
					await this.maybeTeardownAfterSuppression(plugin, pendingFiles);
				}
			}
		}
	}

	async overwriteFileOnce(
		file: TFile,
		opts: { skipIfNoTags?: boolean; postWait?: boolean } = {},
	): Promise<void> {
		if (file.extension !== "md") return;

		const plugin = this.getPlugin();
		const templater = plugin?.templater;
		const overwrite = templater?.overwrite_file_commands;
		if (!plugin || !templater || typeof overwrite !== "function") return;

		const { skipIfNoTags = true, postWait = true } = opts;

		await this.withFileLock(file.path, async () => {
			await waitForFileSettle(this.app, file);

			let original: string;
			try {
				original = await this.app.vault.read(file);
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
				await overwrite.call(templater, file);
				if (postWait) {
					await waitForFileSettle(this.app, file, 800);
				}
			} catch (err) {
				try {
					await this.app.vault.modify(file, original);
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

	async parseTemplate(
		templateContent: string,
		targetFile: TFile,
	): Promise<string> {
		if (targetFile.extension !== "md") return templateContent;

		const templater = this.getPlugin()?.templater;
		const parseTemplate = templater?.parse_template;
		if (!templater || typeof parseTemplate !== "function") {
			return templateContent;
		}

		const createConfig = templater.create_running_config;
		const config =
			typeof createConfig === "function"
				? createConfig.call(templater, undefined, targetFile, 4)
				: { target_file: targetFile, run_mode: 4, frontmatter: {} };

		return await parseTemplate.call(templater, config, templateContent);
	}

	async jumpToNextCursorIfPossible(file: TFile): Promise<void> {
		if (file.extension !== "md") return;

		const plugin = this.getPlugin();
		const autoJumpEnabled = !!plugin?.settings?.auto_jump_to_cursor;
		if (!autoJumpEnabled) return;
		if (this.app.workspace.getActiveFile?.()?.path !== file.path) return;

		const editorHandler = plugin?.editor_handler;
		const jump = editorHandler?.jump_to_next_cursor_location;

		if (typeof jump === "function") {
			try {
				await jump.call(editorHandler, file, true);
				return;
			} catch (err) {
				log.logWarning(
					`jumpToNextTemplaterCursorIfPossible: API failed – ${(err as Error).message}`,
				);
			}
		}

		try {
			(
				this.app.commands as unknown as {
					executeCommandById?: (commandId: string) => boolean;
				}
			).executeCommandById?.(
				"templater-obsidian:jump-to-next-cursor-location",
			);
		} catch {
			// no-op
		}
	}

	private async maybeTeardownAfterSuppression(
		plugin: TemplaterPluginLike,
		pendingFiles: Set<string>,
	): Promise<void> {
		if (this.activeFileCreationSuppressions > 0) return;
		if (pendingFiles.size !== 0) return;

		if (this.suppressionTeardownLock) {
			await this.suppressionTeardownLock;
			return;
		}

		this.suppressionTeardownLock = (async () => {
			try {
				this.app.workspace.trigger("templater:all-templates-executed");
				await plugin.templater?.functions_generator?.teardown?.();
			} catch (err) {
				log.logWarning(
					`withTemplaterFileCreationSuppressed: teardown failed – ${(err as Error).message}`,
				);
			}
		})();

		try {
			await this.suppressionTeardownLock;
		} finally {
			this.suppressionTeardownLock = null;
		}
	}

	private async withFileLock<T>(
		filePath: string,
		fn: () => Promise<T>,
	): Promise<T> {
		const previous = this.renderLocks.get(filePath) ?? Promise.resolve();
		let release!: () => void;
		const current = new Promise<void>((resolve) => {
			release = () => resolve();
		});

		const chain = previous.catch(() => undefined).then(() => current);
		this.renderLocks.set(filePath, chain);

		chain
			.finally(() => {
				if (this.renderLocks.get(filePath) === chain) {
					this.renderLocks.delete(filePath);
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
}

export function createTemplaterIntegration(app: App): TemplaterIntegration {
	return new ObsidianTemplaterIntegration(app);
}

type AppWithPlugins = App & {
	plugins?: { plugins?: Record<string, unknown> };
};

type TemplaterFileCreationSuppressionState = {
	count: number;
	hadPathInitially: boolean;
};

const TEMPLATER_PENDING_CHECK_BUFFER_MS = 350;

function getRawTemplaterPlugin(app: App): unknown | null {
	return (app as AppWithPlugins).plugins?.plugins?.[TEMPLATER_PLUGIN_ID] ?? null;
}

async function waitForFileSettle(
	app: App,
	file: TFile,
	timeoutMs = 500,
): Promise<void> {
	try {
		const adapter = app.vault.adapter;
		if (!("stat" in adapter) || typeof adapter.stat !== "function") return;

		const firstStat = await adapter.stat(file.path);
		if (!firstStat) return;
		let previousMtime = firstStat.mtime;
		const start = Date.now();
		let pollIntervalMs = 30;

		while (Date.now() - start < timeoutMs) {
			await sleep(pollIntervalMs);
			const current = await adapter.stat(file.path);
			if (!current) return;
			if (current.mtime === previousMtime) return;
			previousMtime = current.mtime;
			pollIntervalMs = Math.min(pollIntervalMs * 2, 200);
		}
	} catch (err) {
		log.logWarning(
			`waitForFileSettle: fallback due to adapter/stat failure – ${(err as Error).message}`,
		);
	}
}

async function waitForFileToStopChanging(
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
			} else if (now - start >= gracePeriodMs) {
				return;
			}

			pollIntervalMs = Math.min(Math.floor(pollIntervalMs * 1.5), 200);
		}
	} catch (err) {
		log.logWarning(
			`waitForFileToStopChanging: fallback due to adapter/stat failure – ${(err as Error).message}`,
		);
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
