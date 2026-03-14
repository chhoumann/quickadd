import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	acquireVaultRunLock,
	captureFailureArtifacts,
	clearVaultRunLockMarker,
	createObsidianClient,
	createSandboxApi,
} from "obsidian-e2e";
import type {
	ObsidianClient,
	PluginHandle,
	SandboxApi,
	VaultRunLock,
} from "obsidian-e2e";

const VAULT = "dev";
const PLUGIN_ID = "quickadd";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

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
	await sandbox.write(path, content, {
		waitForContent: true,
		waitOptions: WAIT_OPTS,
	});
}

async function runChoice(name: string, vars: Record<string, unknown>) {
	await obsidian.exec("quickadd:run", {
		choice: name,
		vars: JSON.stringify(vars),
	});
}

async function runChoiceAndWaitForContent(
	name: string,
	vars: Record<string, unknown>,
	file: string,
	expected: string,
) {
	await runChoice(name, vars);
	return sandbox.waitForContent(
		file,
		(content) => content.includes(expected),
		WAIT_OPTS,
	);
}

beforeAll(async () => {
	obsidian = createObsidianClient({ vault: VAULT });
	await obsidian.verify();

	lock = await acquireVaultRunLock({
		vaultName: VAULT,
		vaultPath: await obsidian.vaultPath(),
	});
	await lock.publishMarker(obsidian);

	qa = obsidian.plugin(PLUGIN_ID);
	sandbox = await createSandboxApi({
		obsidian,
		sandboxRoot: "__obsidian_e2e__",
		testName: "template-property-links",
	});
}, 30_000);

afterAll(async () => {
	await qa.restoreData();
	await qa.reload();
	await sandbox.cleanup();
	await clearVaultRunLockMarker(obsidian).catch(() => {});
	await lock?.release();
}, 15_000);

beforeEach((ctx) => {
	ctx.onTestFailed(async () => {
		await captureFailureArtifacts(
			{ id: ctx.task.id, name: ctx.task.name },
			obsidian,
			{ plugin: qa, captureOnFailure: true },
		);
	});
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
		const content = await runChoiceAndWaitForContent(
			"__qa-test-1140-single-link",
			{ authors: ["[[John Doe]]"] },
			"qa-1140-single-link.md",
			'  - "[[John Doe]]"',
		);

		expect(content).toContain("authors:");
		expect(content).toContain('  - "[[John Doe]]"');
		expect(content).not.toContain("authors: [[John Doe]]");
	});

	it("formats multiple wikilinks as separate YAML list items", async () => {
		const content = await runChoiceAndWaitForContent(
			"__qa-test-1140-multi-link",
			{ authors: ["[[John Doe]]", "[[Jane Doe]]"] },
			"qa-1140-multi-link.md",
			'  - "[[Jane Doe]]"',
		);

		expect(content).toContain("authors:");
		expect(content).toContain('  - "[[John Doe]]"');
		expect(content).toContain('  - "[[Jane Doe]]"');
		expect(content).not.toContain("authors: [[John Doe]],[[Jane Doe]]");
	});
});
