import type { App } from "obsidian";

/** The slice of an Obsidian `Plugin` the scheduler needs. */
export interface StartupSyncHost {
	app: Pick<App, "workspace">;
	/** Obsidian `Component.register`: runs the callback when the plugin unloads. */
	register(cleanup: () => void): void;
}

export const STARTUP_MODEL_SYNC_DELAY_MS = 5_000;

/**
 * Run the background model sync shortly after layout-ready, so it never
 * competes with startup work. The pending run belongs to this plugin instance:
 * unloading it (disable, reload, update) cancels the run, including before
 * layout-ready. Otherwise an unloaded instance would still sync against the
 * network seconds after the user turned QuickAdd off.
 */
export function scheduleStartupModelSync(
	host: StartupSyncHost,
	sync: () => void,
	delayMs = STARTUP_MODEL_SYNC_DELAY_MS,
): void {
	let unloaded = false;
	let timer: number | undefined;
	host.register(() => {
		unloaded = true;
		window.clearTimeout(timer);
	});

	host.app.workspace.onLayoutReady(() => {
		if (unloaded) return;
		timer = window.setTimeout(sync, delayMs);
	});
}
