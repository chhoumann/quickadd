import { createSuiteLifecycle } from "./suiteLifecycle";
import { beforeAll, describe, expect, it } from "vitest";
import type {
	ObsidianClient,
	PluginHandle,
	SandboxApi,
} from "obsidian-e2e";
import {
	seedVaultFile,
} from "./e2eVault";

const CHOICE_ID = "__qa-1649-template-frontmatter";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;

type QuickAddData = {
	choices: Record<string, unknown>[];
};

function captureChoice(templatePath: string, outputPath: string) {
	return {
		id: CHOICE_ID,
		name: CHOICE_ID,
		type: "Capture",
		command: false,
		captureTo: outputPath,
		captureToActiveFile: false,
		activeFileWritePosition: "cursor",
		createFileIfItDoesntExist: {
			enabled: true,
			createWithTemplate: true,
			template: templatePath,
		},
		format: {
			enabled: true,
			format:
				"topics: {{VALUE:Alpha,Beta|multi|name:topics|format:yaml}}",
		},
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: true,
			after: "kind: capture",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "",
		},
		newLineCapture: { enabled: true, direction: "below" },
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: false,
		},
	};
}

createSuiteLifecycle("multi-select-formatting", (context) => {
	({ obsidian, sandbox, qa } = context);
});


beforeAll(async () => {
	const templatePath = sandbox.path("template.md");
	await seedVaultFile(
		obsidian,
		sandbox,
		"template.md",
		"---\nkind: capture\n---\n# Template body\n",
	);

	await qa.data<QuickAddData>().patch((data) => {
		data.choices = data.choices.filter((choice) => choice.id !== CHOICE_ID);
		data.choices.push(captureChoice(templatePath, sandbox.path("output.md")));
	});
	await qa.reload({ waitUntilReady: true });
}, 30_000);


describe("issue 1649: explicit multi-select formatting", () => {
	it("writes a native YAML list into template-backed capture frontmatter", async () => {
		await obsidian.exec("quickadd:run", {
			choice: CHOICE_ID,
			vars: JSON.stringify({ topics: ["Alpha", "Beta"] }),
		});
		await sandbox.waitForExists("output.md", WAIT_OPTS);

		const frontmatter = await obsidian.metadata.waitForFrontmatter<{
			kind: string;
			topics: string[];
		}>(
			sandbox.path("output.md"),
			(value) => Array.isArray(value.topics) && value.topics.length === 2,
			WAIT_OPTS,
		);
		const content = await sandbox.read("output.md");

		expect(frontmatter).toMatchObject({
			kind: "capture",
			topics: ["Alpha", "Beta"],
		});
		expect(content).toContain('topics: ["Alpha", "Beta"]');
	});
});
