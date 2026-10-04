import { createSuiteLifecycle } from "./suiteLifecycle";
import { beforeAll, describe, expect, it } from "vitest";
import type { ObsidianClient, PluginHandle, SandboxApi } from "obsidian-e2e";
import { seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";

const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const CHOICE = "__qa-test-inline-property";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;

type QuickAddData = { choices: Record<string, unknown>[] };

createSuiteLifecycle("inline-script-property", (context) => {
	({ obsidian, sandbox, qa } = context);
});

// The InlineScripts docs recipe for setting a property on the new note.
describe("inline script as a property value", () => {
	let script = "";

	beforeAll(async () => {
		const people = sandbox.path("People");
		script = `return this.app.vault.getMarkdownFiles().filter(f => f.parent?.path === '${people}').length + 1`;
		await seedVaultFile(obsidian, sandbox, "People/Grace.md", "---\ntype: person\n---\n");
		await seedVaultFile(obsidian, sandbox, "People/Alan.md", "---\ntype: person\n---\n");
		await seedVaultFile(
			obsidian,
			sandbox,
			"person-template.md",
			'---\ntype: person\nnumber: "```js quickadd ' + script + '```"\n---\n',
		);

		await qa.data<QuickAddData>().patch(withStoredChoices((data) => {
			data.choices = data.choices.filter((choice) => choice.id !== CHOICE);
			data.choices.push({
				id: CHOICE,
				name: CHOICE,
				type: "Template",
				command: false,
				templatePath: sandbox.path("person-template.md"),
				fileNameFormat: { enabled: true, format: `${people}/Ada` },
				folder: {
					enabled: false,
					folders: [],
					chooseWhenCreatingNote: false,
					createInSameFolderAsActiveFile: false,
					chooseFromSubfolders: false,
				},
				appendLink: false,
				openFile: false,
			});
		}));
		await qa.reload({ waitUntilReady: true });
	}, 15_000);

	it("keeps the template valid and fills the property on the new note", async () => {
		const template = await obsidian.metadata.waitForFrontmatter<{ number: string }>(
			sandbox.path("person-template.md"),
			(value) => typeof value.number === "string",
			WAIT_OPTS,
		);
		expect(template.number).toBe("```js quickadd " + script + "```");

		await obsidian.exec("quickadd:run", { choice: CHOICE });
		await sandbox.waitForExists("People/Ada.md", WAIT_OPTS);

		expect(await sandbox.read("People/Ada.md")).toBe('---\ntype: person\nnumber: "3"\n---\n');
	});
});
