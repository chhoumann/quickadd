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

const waitTimeoutMs = Number(process.env.E2E_TIMEOUT_MS) || 15_000;
const WAIT_OPTS = { timeoutMs: waitTimeoutMs, intervalMs: 200 };
const TEST_PREFIX = "__qa-test-964-";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;

type QuickAddData = {
	choices: Record<string, unknown>[];
	migrations: Record<string, boolean>;
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

function macroChoice(
	id: string,
	commands: Array<{ path: string; name?: string }>,
) {
	return {
		id,
		name: id,
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id,
			name: id,
			commands: commands.map(({ path, name }, index) => ({
				id: `${id}-script-${index + 1}`,
				name: name ?? `Script ${index + 1}`,
				type: "UserScript",
				path,
				settings: {},
			})),
		},
	};
}

function clearTestChoices(data: QuickAddData) {
	data.choices = data.choices.filter(
		(choice) => !String(choice.id ?? "").startsWith(TEST_PREFIX),
	);
}

async function seedFile(path: string, content: string) {
	await seedVaultFile(obsidian, sandbox, path, content);
}

async function runChoice(name: string) {
	await obsidian.exec("quickadd:run", { choice: name });
}

async function runChoiceJson(name: string) {
	return await obsidian.execJson<{
		ok: boolean;
		error?: string;
		aborted?: boolean;
	}>("quickadd:run", { choice: name });
}

async function runChoiceAndWaitForContent(
	name: string,
	file: string,
	expected: string,
) {
	await runChoice(name);
	return sandbox.waitForContent(
		file,
		(content) => content.includes(expected),
		WAIT_OPTS,
	);
}

createSuiteLifecycle("macro-member-access", (context) => {
	({ obsidian, sandbox, qa } = context);
});


describe("issue 964: member access across macro user scripts", () => {
	beforeAll(async () => {
		const root = sandbox.root;

		await seedFile(
			"single-script.js",
			'module.exports = { beta: async () => "SINGLE_BETA" };',
		);
		await seedFile(
			"first-script.js",
			[
				"const run = async () => 'FIRST_ENTRY';",
				"run.alpha = async () => 'FIRST_ALPHA';",
				"module.exports = run;",
			].join("\n"),
		);
		await seedFile(
			"second-script.js",
			'module.exports = { beta: async () => "SECOND_BETA" };',
		);
		await seedFile(
			"ambiguous-first-script.js",
			[
				"const run = async () => 'AMBIGUOUS_FIRST_ENTRY';",
				"run.beta = async () => 'FIRST_BETA';",
				"module.exports = run;",
			].join("\n"),
		);

		await seedFile(
			"single-template.md",
			`{{MACRO:${TEST_PREFIX}single-macro::beta}}`,
		);
		await seedFile(
			"multi-template.md",
			`{{MACRO:${TEST_PREFIX}multi-macro::beta}}`,
		);
		await seedFile(
			"ambiguous-template.md",
			`{{MACRO:${TEST_PREFIX}ambiguous-macro::beta}}`,
		);
		await seedFile(
			"ambiguous-qualified-template.md",
			`{{MACRO:${TEST_PREFIX}ambiguous-macro::Second Script::beta}}`,
		);

		await qa.data<QuickAddData>().patch((data) => {
			clearTestChoices(data);
			data.choices.push(
				templateChoice(
					`${TEST_PREFIX}single-template`,
					sandbox.path("single-template.md"),
					`${root}/single-output`,
				),
				templateChoice(
					`${TEST_PREFIX}multi-template`,
					sandbox.path("multi-template.md"),
					`${root}/multi-output`,
				),
				templateChoice(
					`${TEST_PREFIX}ambiguous-template`,
					sandbox.path("ambiguous-template.md"),
					`${root}/ambiguous-output`,
				),
				templateChoice(
					`${TEST_PREFIX}ambiguous-qualified-template`,
					sandbox.path("ambiguous-qualified-template.md"),
					`${root}/ambiguous-qualified-output`,
				),
				macroChoice(`${TEST_PREFIX}single-macro`, [
					{ path: sandbox.path("single-script.js"), name: "Single Script" },
				]),
				macroChoice(`${TEST_PREFIX}multi-macro`, [
					{ path: sandbox.path("first-script.js"), name: "First Script" },
					{ path: sandbox.path("second-script.js"), name: "Second Script" },
				]),
				macroChoice(`${TEST_PREFIX}ambiguous-macro`, [
					{
						path: sandbox.path("ambiguous-first-script.js"),
						name: "First Script",
					},
					{ path: sandbox.path("second-script.js"), name: "Second Script" },
				]),
			);
		});

		await qa.reload({ waitUntilReady: true });
	}, 15_000);

	it("resolves a requested export when the macro has one user script", async () => {
		const content = await runChoiceAndWaitForContent(
			`${TEST_PREFIX}single-template`,
			"single-output.md",
			"SINGLE_BETA",
		);

		expect(content.trim()).toBe("SINGLE_BETA");
	});

	it("reaches an export that exists only on a later user script", async () => {
		const content = await runChoiceAndWaitForContent(
			`${TEST_PREFIX}multi-template`,
			"multi-output.md",
			"SECOND_BETA",
		);

		expect(content.trim()).toBe("SECOND_BETA");
	});

	it("aborts instead of guessing when multiple scripts export the same member", async () => {
		const result = await runChoiceJson(`${TEST_PREFIX}ambiguous-template`);

		expect(result.ok).toBe(false);
		expect(result.aborted).toBe(true);
		expect(result.error).toContain("multiple user scripts exporting 'beta'");
		expect(result.error).toContain("First Script");
		expect(result.error).toContain("Second Script");
		await expect(sandbox.exists("ambiguous-output.md")).resolves.toBe(false);
	});

	it("allows explicit script-name disambiguation when multiple scripts export the same member", async () => {
		const content = await runChoiceAndWaitForContent(
			`${TEST_PREFIX}ambiguous-qualified-template`,
			"ambiguous-qualified-output.md",
			"SECOND_BETA",
		);

		expect(content.trim()).toBe("SECOND_BETA");
	});
});
