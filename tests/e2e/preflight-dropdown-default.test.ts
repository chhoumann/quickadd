import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
const WAIT_OPTS = { timeoutMs: 30_000, intervalMs: 200 };
const TEST_PREFIX = "qa-test-588-";
const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const OUTPUT_FILE = `dropdown-output-${RUN_ID}.md`;
const RUN_MARKER = `qa-preflight-dropdown-${RUN_ID}`;
const VALUE_KEY = `#BF616A,#8CC570,#42A5F5,${RUN_MARKER}`;
const TEST_CHOICE_ID = `${TEST_PREFIX}capture-dropdown-default`;

type QuickAddData = {
	choices: Record<string, unknown>[];
	migrations: Record<string, boolean>;
	onePageInputEnabled?: boolean;
};


let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

function captureChoice(id: string, captureTo: string) {
	return {
		id,
		name: id,
		type: "Capture",
		command: false,
		onePageInput: "always",
		captureTo,
		captureToActiveFile: false,
		createFileIfItDoesntExist: {
			enabled: true,
			createWithTemplate: false,
			template: "",
		},
		format: {
			enabled: true,
			format: `<!-- ${RUN_MARKER} -->\n<mark style="background-color: {{VALUE:${VALUE_KEY}|dropdown|text:red,green,blue,marker}}">selected</mark>`,
		},
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
		newLineCapture: {
			enabled: false,
			direction: "below",
		},
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
		(choice) => !String(choice.id ?? "").startsWith(TEST_PREFIX),
	);
}

async function ensureQuickAddDataFile() {
	const dataPath = await qa.dataPath();

	try {
		await qa.data<QuickAddData>().read();
		return;
	} catch {
		await mkdir(dirname(dataPath), { recursive: true });
		await writeFile(
			dataPath,
			JSON.stringify({ choices: [], migrations: {} }, null, 2),
			"utf8",
		);
	}
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
		console.warn(`preflight-dropdown teardown failed during ${label}`, error);
	}
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
		testName: "preflight-dropdown-default",
	});

	await ensureQuickAddDataFile();
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

describe("issue 588: one-page mapped dropdown defaults", () => {
	beforeAll(async () => {
		await qa.data<QuickAddData>().patch((data) => {
			clearTestChoices(data);
			data.onePageInputEnabled = true;
			data.choices.push(
				captureChoice(TEST_CHOICE_ID, sandbox.path(OUTPUT_FILE)),
			);
		});
		await qa.reload();
		const data = await qa.data<QuickAddData>().read();
		expect(
			data.choices.some((choice) => String(choice.id ?? "") === TEST_CHOICE_ID),
		).toBe(true);
	}, 60_000);

	it("captures the first raw mapped dropdown option when submitted untouched", async () => {
		expect(await sandbox.exists(OUTPUT_FILE)).toBe(false);

		const runExec = await obsidian.exec("quickadd:run", {
			choice: TEST_CHOICE_ID,
			ui: "true",
			vars: JSON.stringify({ __qaE2EOnePageDiagnostics: "true" }),
		});
		expect(runExec.exitCode).toBe(0);

		const content = await sandbox.waitForContent(
			OUTPUT_FILE,
			(fileContent) =>
				fileContent.includes(RUN_MARKER) &&
				fileContent.includes("background-color: #BF616A"),
			WAIT_OPTS,
		);

		expect(content).toContain(RUN_MARKER);
		expect(content).toContain("background-color: #BF616A");
		expect(content).not.toContain("background-color: \">selected");
	});
});
