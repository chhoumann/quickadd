// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { App } from "obsidian";
import QuickAdd from "./main";
import { DEFAULT_SETTINGS } from "./settings";
import { ConsoleErrorLogger } from "./logger/consoleErrorLogger";
import { GuiLogger } from "./logger/guiLogger";
import { log, LogManager } from "./logger/logManager";
import { getQuickAddInstance, setQuickAddInstance } from "./quickAddInstance";

// Disabling and enabling QuickAdd runs onunload and then onload again in the
// same module scope, so whatever onload registers globally has to be gone
// after onunload.
function loadedPlugin(): QuickAdd {
	const plugin = new (QuickAdd as unknown as new () => QuickAdd)();
	Object.assign(plugin, {
		app: new App(),
		settings: structuredClone(DEFAULT_SETTINGS),
		loadData: async () => structuredClone(DEFAULT_SETTINGS),
		saveData: async () => {},
	});
	// What onload registers.
	setQuickAddInstance(plugin);
	log.register(new ConsoleErrorLogger()).register(new GuiLogger());
	return plugin;
}

describe("unloading QuickAdd", () => {
	afterEach(() => {
		log.clear();
		setQuickAddInstance(undefined);
	});

	it("drops its loggers, so the next load does not log everything twice", () => {
		loadedPlugin().onunload();
		expect(LogManager.loggers).toEqual([]);

		loadedPlugin();
		expect(LogManager.loggers).toHaveLength(2);
	});

	it("clears the published plugin instance", () => {
		loadedPlugin().onunload();
		expect(() => getQuickAddInstance()).toThrow(/while QuickAdd is not loaded/);
	});
});
