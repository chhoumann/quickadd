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

const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;

type QuickAddData = {
	choices: Record<string, unknown>[];
	migrations: Record<string, boolean>;
	enableTemplatePropertyTypes?: boolean;
};

function templateChoice(id: string, templatePath: string, format: string) {
	return {
		id,
		name: id,
		type: "Template",
		command: false,
		templatePath,
		fileNameFormat: { enabled: true, format },
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "source",
			focus: false,
		},
	};
}

function clearTestChoices(data: QuickAddData) {
	data.choices = data.choices.filter(
		(choice) => !String(choice.id ?? "").startsWith("__qa-test-1140-"),
	);
}

async function seedTemplate(path: string, content: string) {
	await seedVaultFile(obsidian, sandbox, path, content);
}

async function runChoice(name: string, vars: Record<string, unknown>) {
	await obsidian.exec("quickadd:run", {
		choice: name,
		vars: JSON.stringify(vars),
	});
}

async function runChoiceAndWaitForFile(
	name: string,
	vars: Record<string, unknown>,
	file: string,
) {
	await runChoice(name, vars);
	await sandbox.waitForExists(file, WAIT_OPTS);
}

async function waitForFrontmatter(
	file: string,
	predicate: (frontmatter: { authors: string[] }) => boolean,
) {
	return await obsidian.metadata.waitForFrontmatter<{
		authors: string[];
	}>(
		sandbox.path(file),
		predicate,
		WAIT_OPTS,
	);
}

createSuiteLifecycle("template-property-links", (context) => {
	({ obsidian, sandbox, qa } = context);
});


describe("issue 1140: list properties with links", () => {
	beforeAll(async () => {
		const root = sandbox.root;
		const templatePath = sandbox.path("issue-1140-template.md");

		await seedTemplate(
			"issue-1140-template.md",
			[
				"---",
				"authors: {{VALUE:authors}}",
				"---",
				"",
			].join("\n"),
		);

		await qa.data<QuickAddData>().patch((data) => {
			clearTestChoices(data);
			data.enableTemplatePropertyTypes = true;
			data.choices.push(
				templateChoice(
					"__qa-test-1140-single-link",
					templatePath,
					`${root}/qa-1140-single-link`,
				),
				templateChoice(
					"__qa-test-1140-multi-link",
					templatePath,
					`${root}/qa-1140-multi-link`,
				),
			);
		});

		await qa.reload({ waitUntilReady: true });
	}, 15_000);

	it("formats a single wikilink list item as a YAML list", async () => {
		await runChoiceAndWaitForFile(
			"__qa-test-1140-single-link",
			{ authors: ["[[John Doe]]"] },
			"qa-1140-single-link.md",
		);
		const frontmatter = await waitForFrontmatter(
			"qa-1140-single-link.md",
			(value) =>
				Array.isArray(value.authors) && value.authors.length === 1,
		);

		expect(frontmatter).toMatchObject({
			authors: ["[[John Doe]]"],
		});
	});

	it("formats multiple wikilinks as separate YAML list items", async () => {
		await runChoiceAndWaitForFile(
			"__qa-test-1140-multi-link",
			{ authors: ["[[John Doe]]", "[[Jane Doe]]"] },
			"qa-1140-multi-link.md",
		);
		const frontmatter = await waitForFrontmatter(
			"qa-1140-multi-link.md",
			(value) =>
				Array.isArray(value.authors) && value.authors.length === 2,
		);

		expect(frontmatter).toMatchObject({
			authors: ["[[John Doe]]", "[[Jane Doe]]"],
		});
	});
});
