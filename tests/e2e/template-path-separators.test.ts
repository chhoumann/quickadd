import { expect, it } from "vitest";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral } from "./uiHelpers";

// Windows users type and paste paths with backslashes, and a folder copied from
// a file explorer often keeps its trailing slash. Both must name the same vault
// folder and template as the plain spelling.
const getContext = createQuickAddE2EHarness("template-path-separators");

it("creates the note in the configured folder however its path is spelled", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const template = await seedVaultFile(obsidian, sandbox, "Meta/Templates/Daily.md", "SEPARATOR_BODY");
	const outFolder = sandbox.path("out/nested");
	const toBackslashes = (path: string) => path.replace(/\//g, "\\");

	const variants = [
		{ key: "trailing-slash", templatePath: template, folder: `${outFolder}/` },
		{ key: "backslash-folder", templatePath: template, folder: toBackslashes(outFolder) },
		{ key: "backslash-template", templatePath: toBackslashes(template), folder: outFolder },
	];
	const choices = variants.map(({ key, templatePath, folder }) => {
		const choice = new TemplateChoice(`Separators ${key}`);
		choice.templatePath = templatePath;
		choice.fileNameFormat = { enabled: true, format: `qa-separators-${key}` };
		choice.folder = { ...choice.folder, enabled: true, folders: [folder] };
		return choice;
	});
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices = choices;
	});
	await plugin.reload({ waitUntilReady: true });

	const landed: Record<string, string[]> = {};
	try {
		for (const [index, choice] of choices.entries()) {
			const { key } = variants[index];
			await obsidian.execJson("quickadd:run", { id: choice.id });
			landed[key] = await obsidian.dev.evalJson<string[]>(
				`app.vault.getFiles().filter((f) => f.basename === ${jsLiteral(`qa-separators-${key}`)}).map((f) => f.path)`,
			);
		}
	} finally {
		// A note that fell back to the vault root is outside the sandbox.
		await obsidian.dev.evalJsonAsync(`(async () => {
			for (const f of app.vault.getRoot().children.filter((f) => f.name.startsWith("qa-separators-"))) await app.vault.delete(f);
			return true;
		})()`);
	}

	expect(landed).toEqual({
		"trailing-slash": [`${outFolder}/qa-separators-trailing-slash.md`],
		"backslash-folder": [`${outFolder}/qa-separators-backslash-folder.md`],
		"backslash-template": [`${outFolder}/qa-separators-backslash-template.md`],
	});
	expect((await sandbox.read("out/nested/qa-separators-backslash-template.md")).trim()).toBe("SEPARATOR_BODY");
});
