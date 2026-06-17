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
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
};

function copyOnlyLinkOptions() {
	return {
		enabled: false,
		copyToClipboard: true,
		placement: "replaceSelection",
		requireActiveFile: false,
		linkType: "link",
	};
}

function fileOpening() {
	return {
		location: "tab",
		direction: "vertical",
		mode: "source",
		focus: false,
	};
}

function templateChoice(id: string, templatePath: string, fileName: string) {
	return {
		id,
		name: id,
		type: "Template",
		command: false,
		templatePath,
		fileNameFormat: { enabled: true, format: fileName },
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		appendLink: copyOnlyLinkOptions(),
		openFile: false,
		fileOpening: fileOpening(),
		fileExistsBehavior: { kind: "apply", mode: "overwrite" },
	};
}

function captureChoice(id: string, captureTo: string) {
	return {
		id,
		name: id,
		type: "Capture",
		command: false,
		captureTo,
		captureToActiveFile: false,
		createFileIfItDoesntExist: {
			enabled: true,
			createWithTemplate: false,
			template: "",
		},
		format: { enabled: true, format: "Captured content" },
		prepend: false,
		appendLink: copyOnlyLinkOptions(),
		task: false,
		insertAfter: {
			enabled: false,
			after: "",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "",
		},
		newLineCapture: {
			enabled: false,
			direction: "below",
		},
		openFile: false,
		fileOpening: fileOpening(),
	};
}

function clearTestChoices(data: QuickAddData) {
	data.choices = data.choices.filter(
		(choice) => !String(choice.id ?? "").startsWith("__qa-test-600-"),
	);
}

async function readClipboard() {
	const result = await obsidian.exec("eval", {
		code: "navigator.clipboard.readText()",
	});
	const stdout = String(result.stdout ?? "").trim();
	return stdout.replace(/^=>\s*/, "");
}

async function setClipboard(text: string) {
	await obsidian.exec("eval", {
		code: `navigator.clipboard.writeText(${JSON.stringify(text)})`,
	});
}

async function runChoice(name: string) {
	await obsidian.exec("quickadd:run", { choice: name });
}

async function reloadPluginCode() {
	await obsidian.exec("eval", {
		code: '(async () => { await app.plugins.disablePlugin("quickadd"); await app.plugins.enablePlugin("quickadd"); return true; })()',
	});
}

beforeAll(async () => {
	obsidian = createQuickAddObsidianClient();
	lock = await acquireQuickAddVaultRunLock(obsidian);
	await lock.publishMarker(obsidian);

	qa = obsidian.plugin(PLUGIN_ID);
	sandbox = await createSandboxApi({
		obsidian,
		sandboxRoot: "__obsidian_e2e__",
		testName: "copy-link-to-clipboard",
	});

	await sandbox.write("template.md", "Template content", {
		waitForContent: true,
		waitOptions: WAIT_OPTS,
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

describe("copy produced file link to clipboard", () => {
	beforeAll(async () => {
		const root = sandbox.root;

		await qa.data<QuickAddData>().patch((data) => {
			clearTestChoices(data);
			data.choices.push(
				templateChoice(
					"__qa-test-600-template-copy",
					sandbox.path("template.md"),
					`${root}/template-created`,
				),
				captureChoice(
					"__qa-test-600-capture-copy",
					`${root}/capture-created.md`,
				),
			);
		});

		await reloadPluginCode();
	}, 15_000);

	it("copies the created Template choice link without inserting it", async () => {
		await setClipboard("before-template");

		await runChoice("__qa-test-600-template-copy");
		await sandbox.waitForContent(
			"template-created.md",
			(content) => content.includes("Template content"),
			WAIT_OPTS,
		);

		expect(await readClipboard()).toBe("[[template-created]]");
	});

	it("copies the captured file link without requiring an active target note", async () => {
		await setClipboard("before-capture");

		await runChoice("__qa-test-600-capture-copy");
		await sandbox.waitForContent(
			"capture-created.md",
			(content) => content.includes("Captured content"),
			WAIT_OPTS,
		);

		expect(await readClipboard()).toBe("[[capture-created]]");
	});
});
