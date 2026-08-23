import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	captureFailureArtifacts,
	clearVaultRunLockMarker,
	createSandboxApi,
} from "obsidian-e2e";
import type {
	ObsidianClient,
	PluginHandle,
	SandboxApi,
	VaultRunLock,
} from "obsidian-e2e";
import {
	acquireQuickAddVaultRunLock,
	createQuickAddObsidianClient,
	seedVaultFile,
} from "./e2eVault";

const PLUGIN_ID = "quickadd";
const CHOICE_ID = "__qa-1649-template-frontmatter";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

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

async function runTeardownStep(
	label: string,
	step: () => Promise<unknown> | unknown,
	errors: unknown[],
) {
	try {
		await step();
	} catch (error) {
		errors.push(error);
		console.warn(`multi-select formatting teardown failed during ${label}`, error);
	}
}

beforeAll(async () => {
	obsidian = createQuickAddObsidianClient();
	lock = await acquireQuickAddVaultRunLock(obsidian);
	await lock.publishMarker(obsidian);

	qa = obsidian.plugin(PLUGIN_ID);
	sandbox = await createSandboxApi({
		obsidian,
		sandboxRoot: "__obsidian_e2e__",
		testName: "multi-select-formatting",
	});

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

afterAll(async () => {
	const errors: unknown[] = [];
	await runTeardownStep("restoreData", () => qa?.restoreData?.(), errors);
	await runTeardownStep("reload", () => qa?.reload?.(), errors);
	await runTeardownStep("sandbox cleanup", () => sandbox?.cleanup?.(), errors);
	await runTeardownStep(
		"clear vault run lock marker",
		() => (obsidian ? clearVaultRunLockMarker(obsidian) : undefined),
		errors,
	);
	await runTeardownStep("release vault lock", () => lock?.release(), errors);

	if (errors.length > 0) throw errors[0];
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
