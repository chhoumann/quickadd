import { describe, expect, it } from "vitest";
import type QuickAdd from "src/main";
import migrateToMultipleTemplateFolders from "./migrateToMultipleTemplateFolders";

function pluginWith(settings: Record<string, unknown>): QuickAdd {
	return { settings } as unknown as QuickAdd;
}

const run = (plugin: QuickAdd) =>
	migrateToMultipleTemplateFolders.migrate(plugin);

describe("migrateToMultipleTemplateFolders", () => {
	it("folds a legacy single path into the list and drops the dead key", async () => {
		const plugin = pluginWith({ templateFolderPath: "templates" });

		await run(plugin);

		expect(plugin.settings.templateFolderPaths).toEqual(["templates"]);
		expect(
			(plugin.settings as { templateFolderPath?: unknown }).templateFolderPath,
		).toBeUndefined();
	});

	it("stores the legacy value in canonical (normalized) form", async () => {
		const plugin = pluginWith({ templateFolderPath: "  /templates/ " });

		await run(plugin);

		expect(plugin.settings.templateFolderPaths).toEqual(["templates"]);
	});

	it("does not let a blank-only array shadow a valid legacy value", async () => {
		const plugin = pluginWith({
			templateFolderPath: "Templates",
			templateFolderPaths: [" ", null],
		});

		await run(plugin);

		expect(plugin.settings.templateFolderPaths).toEqual(["Templates"]);
	});

	it("canonicalizes an existing populated list", async () => {
		const plugin = pluginWith({
			templateFolderPaths: ["/a/", "a", "b/"],
		});

		await run(plugin);

		expect(plugin.settings.templateFolderPaths).toEqual(["a", "b"]);
	});

	it("yields an empty list on a fresh install (no legacy value)", async () => {
		const plugin = pluginWith({});

		await run(plugin);

		expect(plugin.settings.templateFolderPaths).toEqual([]);
	});

	it("treats a blank legacy value as no folder", async () => {
		const plugin = pluginWith({ templateFolderPath: "   " });

		await run(plugin);

		expect(plugin.settings.templateFolderPaths).toEqual([]);
		expect(
			(plugin.settings as { templateFolderPath?: unknown }).templateFolderPath,
		).toBeUndefined();
	});

	it("does not overwrite an already-populated list", async () => {
		const plugin = pluginWith({
			templateFolderPath: "legacy",
			templateFolderPaths: ["a", "b"],
		});

		await run(plugin);

		expect(plugin.settings.templateFolderPaths).toEqual(["a", "b"]);
	});

	it("is idempotent across repeated runs", async () => {
		const plugin = pluginWith({ templateFolderPath: "templates" });

		await run(plugin);
		await run(plugin);

		expect(plugin.settings.templateFolderPaths).toEqual(["templates"]);
	});
});
