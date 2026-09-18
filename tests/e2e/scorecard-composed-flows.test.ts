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

const TEST_PREFIX = "__qa-scorecard-";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;

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

createSuiteLifecycle("scorecard-composed-flows", (context) => {
	({ obsidian, sandbox, qa } = context);
});


describe("scorecard final acceptance composed flows", () => {
	beforeAll(async () => {
		const templateId = `${TEST_PREFIX}template`;
		const captureId = `${TEST_PREFIX}capture`;
		const macroId = `${TEST_PREFIX}macro`;
		const multiId = `${TEST_PREFIX}multi`;
		const multiCaptureId = `${TEST_PREFIX}multi-capture`;

		await seedVaultFile(
			obsidian,
			sandbox,
			"scorecard-template.md",
			"scorecard template body",
		);
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
