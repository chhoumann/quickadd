import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App, Notice } from "obsidian";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import ChoiceSuggester from "./choiceSuggester";
import { NO_CHOICES_NOTICE, openChoiceLauncher } from "./openChoiceLauncher";

type LauncherPluginSettings = {
	choices: unknown;
	templateFolderPaths?: string[];
	/** `undefined` is the legacy data.json shape, which means "bottom". */
	templateFolderLauncherRow?: "off" | "top" | "bottom";
};

function noticeMessages(): string[] {
	return (
		Notice as unknown as { instances: Array<{ message: string }> }
	).instances.map((n) => n.message);
}

describe("openChoiceLauncher", () => {
	let openSpy: ReturnType<typeof vi.spyOn>;
	let openTabById: ReturnType<typeof vi.fn>;
	let app: App;

	function pluginWith(settings: LauncherPluginSettings): QuickAdd {
		return {
			app,
			manifest: { id: "quickadd" },
			settings: {
				templateFolderPaths: settings.templateFolderPaths ?? [],
				// Passed through verbatim (including undefined) so the production
				// `?? "bottom"` fallback is the thing under test.
				templateFolderLauncherRow: settings.templateFolderLauncherRow,
				choices: settings.choices,
			},
		} as unknown as QuickAdd;
	}

	const aChoice = (): IChoice =>
		({ id: "c1", name: "Add task", type: "Capture", command: false }) as IChoice;

	beforeEach(() => {
		app = new App();
		openTabById = vi.fn();
		(app as unknown as { setting: unknown }).setting = {
			open: vi.fn(),
			openTabById,
		};
		openSpy = vi.spyOn(ChoiceSuggester, "Open").mockImplementation(() => {});
		(Notice as unknown as { instances: unknown[] }).instances = [];
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// Issue #1540: the fresh-install path. An empty picker over "No results
	// found." is a dead end; send the user to where choices are made instead.
	it("opens settings instead of an empty picker when there is nothing to run", () => {
		openChoiceLauncher(pluginWith({ choices: [] }));

		expect(openSpy).not.toHaveBeenCalled();
		expect(noticeMessages()).toEqual([NO_CHOICES_NOTICE]);
		expect(openTabById).toHaveBeenCalledWith("quickadd");
	});

	// The notice already names "Settings → QuickAdd", so a second generic notice
	// about not being able to open settings would just be noise.
	it("does not stack a second notice when settings cannot be opened", () => {
		const plugin = pluginWith({ choices: [] });
		(plugin.app as unknown as { setting: unknown }).setting = undefined;

		openChoiceLauncher(plugin);

		expect(noticeMessages()).toEqual([NO_CHOICES_NOTICE]);
	});

	it("opens the picker as soon as there is a choice", () => {
		openChoiceLauncher(pluginWith({ choices: [aChoice()] }));

		expect(noticeMessages()).toEqual([]);
		expect(openTabById).not.toHaveBeenCalled();
		expect(openSpy).toHaveBeenCalledWith(expect.anything(), [aChoice()], {
			includeTemplateFolderRow: true,
		});
	});

	// With zero choices but a configured template folder the launcher still has a
	// working action ("New note from template…"), so the guard must not fire.
	it.each(["bottom", "top"] as const)(
		"opens the picker for a template-folder row at %s with zero choices",
		(templateFolderLauncherRow) => {
			openChoiceLauncher(
				pluginWith({
					choices: [],
					templateFolderPaths: ["Templates"],
					templateFolderLauncherRow,
				}),
			);

			expect(openSpy).toHaveBeenCalled();
			expect(noticeMessages()).toEqual([]);
		},
	);

	it("guards again once the template-folder row is turned off", () => {
		openChoiceLauncher(
			pluginWith({
				choices: [],
				templateFolderPaths: ["Templates"],
				templateFolderLauncherRow: "off",
			}),
		);

		expect(openSpy).not.toHaveBeenCalled();
		expect(noticeMessages()).toEqual([NO_CHOICES_NOTICE]);
	});

	// Legacy data.json has no templateFolderLauncherRow at all; DEFAULT_SETTINGS
	// treats that as "bottom", so the row (and the picker) must still appear.
	it("treats a missing row position as 'bottom'", () => {
		openChoiceLauncher(
			pluginWith({
				choices: [],
				templateFolderPaths: ["Templates"],
				templateFolderLauncherRow: undefined,
			}),
		);

		expect(openSpy).toHaveBeenCalled();
		expect(noticeMessages()).toEqual([]);
	});

	// A corrupt data.json keeps a non-array `choices` (main.ts deliberately does
	// not overwrite it), which used to make "QuickAdd: Run" throw a TypeError.
	it("falls back to the first-run guidance on a corrupt choices list", () => {
		openChoiceLauncher(pluginWith({ choices: null }));

		expect(openSpy).not.toHaveBeenCalled();
		expect(noticeMessages()).toEqual([NO_CHOICES_NOTICE]);
	});
});
