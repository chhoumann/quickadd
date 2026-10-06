import { afterEach, describe, expect, it, vi } from "vitest";
import { App, type Plugin, SettingPage } from "obsidian";
import { BuilderPage } from "../gui/ChoiceBuilder/builderPage";
import { registerSaveOnExit } from "./registerSaveOnExit";

class TestBuilderPage extends BuilderPage<string> {
	constructor(app: App, title: string, saved: string[]) {
		super(app, title, (result) => saved.push(result));
	}
	protected render(): void {}
	protected result(): string {
		return this.title;
	}
}

class OtherPage extends SettingPage {
	display(): void {}
}

const listeners: (() => void)[] = [];

function setup(pendingWrite: Promise<void> | null = Promise.resolve()) {
	const saved: string[] = [];
	const app = new App() as App & {
		setting: { pageStack: { page: SettingPage }[]; clearPageStack: () => void };
	};
	const macro = new TestBuilderPage(app, "Macro", saved);
	const branch = new TestBuilderPage(app, "Then", saved);
	app.setting = {
		// Bottom to top, as Obsidian keeps it: another page, a macro, its branch.
		pageStack: [{ page: new OtherPage() }, { page: macro }, { page: branch }],
		clearPageStack: vi.fn(() => {
			while (app.setting.pageStack.length) app.setting.pageStack.pop()?.page.hide();
		}),
	};
	let quit: (tasks: { addPromise: (promise: Promise<unknown>) => void }) => void = () => {};
	(app.workspace as unknown as { on: (name: string, callback: typeof quit) => object }).on = (
		name,
		callback,
	) => {
		if (name === "quit") quit = callback;
		return {};
	};
	const plugin = {
		app,
		registerEvent: vi.fn(),
		registerDomEvent: (el: EventTarget, type: string, callback: (event: Event) => void) => {
			el.addEventListener(type, callback);
			listeners.push(() => el.removeEventListener(type, callback));
		},
	} as unknown as Plugin;
	const flush = vi.fn(() => pendingWrite);
	registerSaveOnExit(plugin, flush);
	return { app, saved, flush, write: pendingWrite, quit: (tasks: Parameters<typeof quit>[0]) => quit(tasks) };
}

function goToBackground(state: DocumentVisibilityState) {
	Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
	document.dispatchEvent(new Event("visibilitychange"));
}

describe("registerSaveOnExit", () => {
	afterEach(() => {
		delete (document as { visibilityState?: unknown }).visibilityState;
		while (listeners.length) listeners.pop()?.();
	});

	it("leaves open builder pages on quit, top first, and has Obsidian wait for the write", () => {
		const { app, saved, flush, write, quit } = setup();
		const addPromise = vi.fn();

		quit({ addPromise });

		expect(app.setting.clearPageStack).toHaveBeenCalledTimes(1);
		expect(saved).toEqual(["Then", "Macro"]);
		expect(flush).toHaveBeenCalledTimes(1);
		expect(addPromise).toHaveBeenCalledWith(write);
	});

	// Obsidian cancels the window close and shows "Saving..." whenever quit
	// is handed something to wait for (#2194).
	it("hands Obsidian nothing to wait for on quit when there is nothing to save", () => {
		const { flush, quit } = setup(null);
		const addPromise = vi.fn();

		quit({ addPromise });

		expect(flush).toHaveBeenCalledTimes(1);
		expect(addPromise).not.toHaveBeenCalled();
	});

	it("saves open builder pages in place, top first, and writes when the app goes to the background", () => {
		const { app, saved, flush } = setup();

		goToBackground("hidden");

		expect(saved).toEqual(["Then", "Macro"]);
		expect(app.setting.pageStack).toHaveLength(3);
		expect(app.setting.clearPageStack).not.toHaveBeenCalled();
		expect(flush).toHaveBeenCalledTimes(1);

		goToBackground("visible");
		expect(saved).toHaveLength(2);
		expect(flush).toHaveBeenCalledTimes(1);
	});

	// iOS: the app switcher makes the app inactive while the page stays
	// visible, and the app can be force-quit from there. Obsidian reports it
	// as a blur of the window.
	it("saves open builder pages in place and writes when the window loses focus", () => {
		const { app, saved, flush } = setup();
		const field = document.body.appendChild(document.createElement("input"));

		field.dispatchEvent(new FocusEvent("blur"));
		expect(saved).toEqual([]);
		expect(flush).not.toHaveBeenCalled();

		window.dispatchEvent(new FocusEvent("blur"));
		expect(saved).toEqual(["Then", "Macro"]);
		expect(app.setting.pageStack).toHaveLength(3);
		expect(flush).toHaveBeenCalledTimes(1);
		field.remove();
	});
});
