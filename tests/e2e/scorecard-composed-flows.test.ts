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
} from "./e2eVault";

const PLUGIN_ID = "quickadd";
const TEST_PREFIX = "__qa-scorecard-";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
	migrations: Record<string, boolean>;
};

function templateChoice(id: string) {
	return {
		id,
		name: id,
		type: "Template",
		command: false,
		templatePath: sandbox.path("scorecard-template.md"),
		fileNameFormat: {
			enabled: true,
			format: sandbox.path("scorecard-template-output"),
		},
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

function captureChoice(id: string, content: string) {
	return {
		id,
		name: id,
		type: "Capture",
		command: false,
		captureTo: sandbox.path("scorecard-capture-target.md"),
		captureToActiveFile: false,
		activeFileWritePosition: "cursor",
		createFileIfItDoesntExist: {
			enabled: true,
			createWithTemplate: false,
			template: "",
		},
		format: { enabled: true, format: content },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: false,
			after: "",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "",
		},
		newLineCapture: { enabled: false, direction: "below" },
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: false,
		},
	};
}

function macroChoice(id: string, childChoiceIds: string[]) {
	return {
		id,
		name: id,
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id,
			name: id,
			commands: childChoiceIds.map((choiceId, index) => ({
				id: `${id}-choice-${index + 1}`,
				name: `Run ${choiceId}`,
				type: "Choice",
				choiceId,
			})),
		},
	};
}

function multiChoice(id: string, choices: Record<string, unknown>[]) {
	return {
		id,
		name: id,
		type: "Multi",
		command: false,
		choices,
	};
}

function clearTestChoices(data: QuickAddData) {
	data.choices = data.choices.filter(
		(choice) => !String(choice.id ?? "").startsWith(TEST_PREFIX),
	);
}

async function runChoice(name: string) {
	await obsidian.exec("quickadd:run", { choice: name });
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
		console.warn(`scorecard-composed teardown failed during ${label}`, error);
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
		testName: "scorecard-composed-flows",
	});
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

	if (errors.length > 0) {
		throw errors[0];
	}
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

describe("scorecard final acceptance composed flows", () => {
	beforeAll(async () => {
		const templateId = `${TEST_PREFIX}template`;
		const captureId = `${TEST_PREFIX}capture`;
		const macroId = `${TEST_PREFIX}macro`;
		const multiId = `${TEST_PREFIX}multi`;
		const multiCaptureId = `${TEST_PREFIX}multi-capture`;

		await sandbox.write("scorecard-template.md", "scorecard template body", {
			waitForContent: true,
			waitOptions: WAIT_OPTS,
		});
		await sandbox.delete("scorecard-template-output.md");
		await sandbox.delete("scorecard-capture-target.md");

		await qa.data<QuickAddData>().patch((data) => {
			clearTestChoices(data);
			const template = templateChoice(templateId);
			const capture = captureChoice(captureId, "scorecard capture body");
			const multiChild = captureChoice(
				multiCaptureId,
				"scorecard multi child body",
			);

			data.choices.push(
				template,
				capture,
				macroChoice(macroId, [templateId, captureId]),
				multiChoice(multiId, [multiChild]),
			);
		});

		await qa.reload();
	});

	it("runs a macro that composes template and capture choices", async () => {
		await runChoice(`${TEST_PREFIX}macro`);

		await sandbox.waitForContent(
			"scorecard-template-output.md",
			(content) => content.includes("scorecard template body"),
			WAIT_OPTS,
		);
		await sandbox.waitForContent(
			"scorecard-capture-target.md",
			(content) => content.includes("scorecard capture body"),
			WAIT_OPTS,
		);
	});

	it("exposes multi child routing and runs the routed child choice", async () => {
		const listed = await obsidian.execJson<{
			choices: Array<{ name: string; path: string; runnable: boolean }>;
		}>("quickadd:list");
		const multi = listed.choices.find(
			(choice) => choice.name === `${TEST_PREFIX}multi`,
		);
		const child = listed.choices.find(
			(choice) => choice.name === `${TEST_PREFIX}multi-capture`,
		);

		expect(multi).toMatchObject({
			path: `${TEST_PREFIX}multi`,
			runnable: false,
		});
		expect(child).toMatchObject({
			path: `${TEST_PREFIX}multi / ${TEST_PREFIX}multi-capture`,
			runnable: true,
		});

		await runChoice(`${TEST_PREFIX}multi-capture`);
		await sandbox.waitForContent(
			"scorecard-capture-target.md",
			(content) => content.includes("scorecard multi child body"),
			WAIT_OPTS,
		);
	});
});
