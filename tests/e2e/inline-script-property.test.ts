import { createSuiteLifecycle } from "./suiteLifecycle";
import { beforeAll, describe, expect, it } from "vitest";
import type { ObsidianClient, PluginHandle, SandboxApi } from "obsidian-e2e";
import { seedVaultFile } from "./e2eVault";

const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const CHOICE = "__qa-test-inline-property";
const OTHER_NOTE = "other-note.md";
const OTHER_CONTENT = "---\ntype: project\n---\n# Other note\n";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;

type QuickAddData = { choices: Record<string, unknown>[] };

createSuiteLifecycle("inline-script-property", (context) => {
	({ obsidian, sandbox, qa } = context);
});

// The InlineScripts docs recipe for setting a property on the new note.
describe("inline script as a property value", () => {
	beforeAll(async () => {
		await seedVaultFile(
			obsidian,
			sandbox,
			"person-template.md",
			"---\ntype: \"```js quickadd return 'person'```\"\n---\n# Person\n",
		);
		await seedVaultFile(obsidian, sandbox, OTHER_NOTE, OTHER_CONTENT);

		await qa.data<QuickAddData>().patch((data) => {
			data.choices = data.choices.filter((choice) => choice.id !== CHOICE);
			data.choices.push({
				id: CHOICE,
				name: CHOICE,
				type: "Template",
				command: false,
				templatePath: sandbox.path("person-template.md"),
				fileNameFormat: { enabled: true, format: `${sandbox.root}/Ada` },
				folder: {
					enabled: false,
					folders: [],
					chooseWhenCreatingNote: false,
					createInSameFolderAsActiveFile: false,
					chooseFromSubfolders: false,
				},
				appendLink: false,
				openFile: true,
				fileOpening: { location: "tab", direction: "vertical", mode: "source", focus: true },
			});
		});
		await qa.reload({ waitUntilReady: true });
	}, 15_000);

	it("keeps the template valid and sets the property only on the new note", async () => {
		const template = await obsidian.metadata.waitForFrontmatter<{ type: string }>(
			sandbox.path("person-template.md"),
			(value) => typeof value.type === "string",
			WAIT_OPTS,
		);
		expect(template.type).toBe("```js quickadd return 'person'```");

		await obsidian.dev.evalJsonAsync(`(async () => {
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(sandbox.path(OTHER_NOTE))}));
			app.workspace.setActiveLeaf(leaf, { focus: true });
			return true;
		})()`);

		await obsidian.exec("quickadd:run", { choice: CHOICE });
		await sandbox.waitForExists("Ada.md", WAIT_OPTS);

		expect(await sandbox.read("Ada.md")).toBe("---\ntype: \"person\"\n---\n# Person\n");
		expect(await sandbox.read(OTHER_NOTE)).toBe(OTHER_CONTENT);
	});
});
