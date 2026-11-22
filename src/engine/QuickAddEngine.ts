import type { App } from "obsidian";

/** What every engine shares: the app it runs in and a `run()` entry point. */
export abstract class QuickAddEngine {
	public app: App;

	protected constructor(app: App) {
		this.app = app;
	}

	public abstract run(): void | Promise<unknown>;
}
