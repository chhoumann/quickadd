import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	acquireVaultRunLock,
	captureFailureArtifacts,
	clearVaultRunLockMarker,
	createObsidianClient,
	createSandboxApi,
} from "obsidian-e2e";
import type { ObsidianClient, SandboxApi, PluginHandle, VaultRunLock } from "obsidian-e2e";

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const VAULT = "dev";
const PLUGIN_ID = "quickadd";
const TPL_CONTENT = "QA_TEMPLATE_CONTENT";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
	migrations: Record<string, boolean>;
};

const behavior = {
	increment: { kind: "apply", mode: "increment" },
	duplicateSuffix: { kind: "apply", mode: "duplicateSuffix" },
	appendBottom: { kind: "apply", mode: "appendBottom" },
	appendTop: { kind: "apply", mode: "appendTop" },
	overwrite: { kind: "apply", mode: "overwrite" },
	doNothing: { kind: "apply", mode: "doNothing" },
	prompt: { kind: "prompt" },
} as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function templateChoice(
	id: string,
	format: string,
	fileExistsBehavior?: Record<string, unknown>,
) {
	return {
		id,
		name: id,
		type: "Template",
		command: false,
		templatePath: sandbox.path("tpl.md"),
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
		...(fileExistsBehavior && { fileExistsBehavior }),
	};
}

/** Write a file into the sandbox and wait for Obsidian to index it. */
async function seedFile(name: string, content = "EXISTING") {
	await sandbox.write(name, content, { waitForContent: true, waitOptions: WAIT_OPTS });
}

/** Run a QuickAdd choice. */
async function runChoice(name: string) {
	await obsidian.exec("quickadd:run", { choice: name });
}

/** Run a QuickAdd choice and wait for a new file to appear. */
async function runChoiceAndWaitFor(name: string, expectedFile: string) {
	await runChoice(name);
	await sandbox.waitForExists(expectedFile, WAIT_OPTS);
}

/** Run a QuickAdd choice and poll until the file contains the expected content. */
async function runChoiceAndWaitForContent(name: string, file: string, expected: string): Promise<string> {
	await runChoice(name);
	return sandbox.waitForContent(file, (c) => c.includes(expected), WAIT_OPTS);
}

/** Remove any existing test choices from plugin data. */
function clearTestChoices(data: QuickAddData) {
	data.choices = data.choices.filter(
		(c) => !String(c.id ?? "").startsWith("__qa-test-"),
	);
}

/** Find a choice by ID in plugin data. */
function findChoice(data: QuickAddData, id: string) {
	return data.choices.find((c) => c.id === id) as Record<string, unknown> | undefined;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeAll(async () => {
	obsidian = createObsidianClient({
		vault: VAULT,
		defaultExecOptions: { allowNonZeroExit: true },
	});
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
		testName: "file-exists",
	});

	await seedFile("tpl.md", TPL_CONTENT);
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

// ---------------------------------------------------------------------------
// Phase 1: Functional tests
// ---------------------------------------------------------------------------

describe("functional: file collision behaviors", () => {
	beforeAll(async () => {
		const root = sandbox.root;

		await qa.data<QuickAddData>().patch((data) => {
			clearTestChoices(data);

			data.choices.push(
				templateChoice("__qa-test-t01-create", `${root}/qa-t01-new`, behavior.increment),
				templateChoice("__qa-test-t02-incr", `${root}/qa-t02-incr`, behavior.increment),
				templateChoice("__qa-test-t03-chain", `${root}/qa-t03-chain`, behavior.increment),
				templateChoice("__qa-test-t04-zeros", `${root}/tt0780504`, behavior.increment),
				templateChoice("__qa-test-t05-pad", `${root}/qa-t05-note009`, behavior.increment),
				templateChoice("__qa-test-t06-dup", `${root}/qa-t06-dup`, behavior.duplicateSuffix),
				templateChoice("__qa-test-t07-chain", `${root}/qa-t07-chain`, behavior.duplicateSuffix),
				templateChoice("__qa-test-t08-digits", `${root}/qa-t08-note1`, behavior.duplicateSuffix),
				templateChoice("__qa-test-t09-abot", `${root}/qa-t09-append-bot`, behavior.appendBottom),
				templateChoice("__qa-test-t10-atop", `${root}/qa-t10-append-top`, behavior.appendTop),
				templateChoice("__qa-test-t11-over", `${root}/qa-t11-overwrite`, behavior.overwrite),
				templateChoice("__qa-test-t12-noop", `${root}/qa-t12-nothing`, behavior.doNothing),
				templateChoice("__qa-test-t13-alldigit", `${root}/0001`, behavior.increment),
				templateChoice("__qa-test-t14-nodigit", `${root}/qa-t14-hello`, behavior.increment),
				templateChoice("__qa-test-t15-dupid", `${root}/tt0780504`, behavior.duplicateSuffix),
			);
		});

		await qa.reload({ waitUntilReady: true });
	}, 15_000);

	it("T01: no collision - creates file normally", async () => {
		await runChoiceAndWaitForContent("__qa-test-t01-create", "qa-t01-new.md", TPL_CONTENT);
	});

	it("T02: increment basic (Note -> Note1)", async () => {
		await seedFile("qa-t02-incr.md");
		await runChoiceAndWaitFor("__qa-test-t02-incr", "qa-t02-incr1.md");
		expect(await sandbox.exists("qa-t02-incr.md")).toBe(true);
	});

	it("T03: increment chained (skips existing Note1)", async () => {
		await seedFile("qa-t03-chain.md");
		await seedFile("qa-t03-chain1.md");
		await runChoiceAndWaitFor("__qa-test-t03-chain", "qa-t03-chain2.md");
	});

	it("T04: increment preserves leading zeros (tt0780504 -> tt0780505)", async () => {
		await seedFile("tt0780504.md");
		await runChoiceAndWaitFor("__qa-test-t04-zeros", "tt0780505.md");
		expect(await sandbox.exists("tt780505.md")).toBe(false);
	});

	it("T05: increment zero-padded (note009 -> note010)", async () => {
		await seedFile("qa-t05-note009.md");
		await runChoiceAndWaitFor("__qa-test-t05-pad", "qa-t05-note010.md");
		expect(await sandbox.exists("qa-t05-note10.md")).toBe(false);
	});

	it("T06: duplicate suffix basic (Note -> Note (1))", async () => {
		await seedFile("qa-t06-dup.md");
		await runChoiceAndWaitFor("__qa-test-t06-dup", "qa-t06-dup (1).md");
		expect(await sandbox.exists("qa-t06-dup.md")).toBe(true);
	});

	it("T07: duplicate suffix chained (skips existing (1))", async () => {
		await seedFile("qa-t07-chain.md");
		await seedFile("qa-t07-chain (1).md");
		await runChoiceAndWaitFor("__qa-test-t07-chain", "qa-t07-chain (2).md");
	});

	it("T08: duplicate suffix preserves trailing digits (note1 -> note1 (1))", async () => {
		await seedFile("qa-t08-note1.md");
		await runChoiceAndWaitFor("__qa-test-t08-digits", "qa-t08-note1 (1).md");
		expect(await sandbox.exists("qa-t08-note2.md")).toBe(false);
	});

	it("T09: append to bottom", async () => {
		await seedFile("qa-t09-append-bot.md", "ORIGINAL_BOTTOM_TEST");
		const content = await runChoiceAndWaitForContent("__qa-test-t09-abot", "qa-t09-append-bot.md", TPL_CONTENT);
		expect(content).toContain("ORIGINAL_BOTTOM_TEST");
	});

	it("T10: append to top", async () => {
		await seedFile("qa-t10-append-top.md", "ORIGINAL_TOP_TEST");
		const content = await runChoiceAndWaitForContent("__qa-test-t10-atop", "qa-t10-append-top.md", TPL_CONTENT);
		expect(content).toContain("ORIGINAL_TOP_TEST");
	});

	it("T11: overwrite", async () => {
		await seedFile("qa-t11-overwrite.md", "OLD_CONTENT_TO_REPLACE");
		const content = await runChoiceAndWaitForContent("__qa-test-t11-over", "qa-t11-overwrite.md", TPL_CONTENT);
		expect(content).not.toContain("OLD_CONTENT_TO_REPLACE");
	});

	it("T12: do nothing - keeps file unchanged", async () => {
		await seedFile("qa-t12-nothing.md", "UNTOUCHED_CONTENT");
		await runChoice("__qa-test-t12-noop");
		await obsidian.sleep(600);
		const content = await sandbox.read("qa-t12-nothing.md");
		expect(content).toContain("UNTOUCHED_CONTENT");
		expect(content).not.toContain(TPL_CONTENT);
	});

	it("T13: increment all-digit filename (0001 -> 0002)", async () => {
		await seedFile("0001.md");
		await runChoiceAndWaitFor("__qa-test-t13-alldigit", "0002.md");
		expect(await sandbox.exists("2.md")).toBe(false);
	});

	it("T14: increment no trailing digits (hello -> hello1)", async () => {
		await seedFile("qa-t14-hello.md");
		await runChoiceAndWaitFor("__qa-test-t14-nodigit", "qa-t14-hello1.md");
	});

	it("T15: duplicate suffix on identifier-like name (tt0780504 -> tt0780504 (1))", async () => {
		await seedFile("tt0780504.md");
		await runChoiceAndWaitFor("__qa-test-t15-dupid", "tt0780504 (1).md");
		expect(await sandbox.exists("tt0780505 (1).md")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Phase 2: Migration tests
// ---------------------------------------------------------------------------

describe("migration: consolidateFileExistsBehavior", () => {
	beforeAll(async () => {
		const root = sandbox.root;
		const migrationChoice = (id: string) => templateChoice(id, `${root}/migration-test`);

		await qa.data<QuickAddData>().patch((data) => {
			clearTestChoices(data);

			data.choices.push(
				{ ...migrationChoice("__qa-test-m1-incr-flag"), incrementFileName: true },
				{ ...migrationChoice("__qa-test-m2-set-mode"), setFileExistsBehavior: true, fileExistsMode: "Overwrite the file" },
				{ ...migrationChoice("__qa-test-m3-prompt"), setFileExistsBehavior: false, fileExistsMode: "Append to the bottom of the file" },
				{ ...migrationChoice("__qa-test-m4-dup"), setFileExistsBehavior: true, fileExistsMode: "Append duplicate suffix" },
				{ ...migrationChoice("__qa-test-m5-both"), incrementFileName: true, setFileExistsBehavior: true, fileExistsMode: "Append duplicate suffix" },
				{ ...migrationChoice("__qa-test-m6-already"), fileExistsBehavior: { kind: "apply", mode: "overwrite" } },
			);

			data.migrations.consolidateFileExistsBehavior = false;
			data.migrations.incrementFileNameSettingMoveToDefaultBehavior = true;
		});

		await qa.reload();
		await qa.waitForData<QuickAddData>(
			(data) => data.migrations.consolidateFileExistsBehavior === true,
			{ timeoutMs: 10_000, intervalMs: 300 },
		);
	}, 15_000);

	async function readChoice(id: string) {
		const data = await qa.data<QuickAddData>().read();
		return findChoice(data, id);
	}

	it("M1: legacy incrementFileName -> apply/increment", async () => {
		const choice = await readChoice("__qa-test-m1-incr-flag");
		expect(choice?.fileExistsBehavior).toEqual(behavior.increment);
		expect(choice).not.toHaveProperty("incrementFileName");
	});

	it("M2: legacy setFileExistsBehavior + overwrite -> apply/overwrite", async () => {
		const choice = await readChoice("__qa-test-m2-set-mode");
		expect(choice?.fileExistsBehavior).toEqual(behavior.overwrite);
		expect(choice).not.toHaveProperty("setFileExistsBehavior");
		expect(choice).not.toHaveProperty("fileExistsMode");
	});

	it("M3: legacy setFileExistsBehavior=false -> prompt", async () => {
		const choice = await readChoice("__qa-test-m3-prompt");
		expect(choice?.fileExistsBehavior).toEqual(behavior.prompt);
	});

	it("M4: legacy duplicate suffix mode -> apply/duplicateSuffix", async () => {
		const choice = await readChoice("__qa-test-m4-dup");
		expect(choice?.fileExistsBehavior).toEqual(behavior.duplicateSuffix);
	});

	it("M5: explicit legacy mode wins when both legacy settings are present", async () => {
		const choice = await readChoice("__qa-test-m5-both");
		expect(choice?.fileExistsBehavior).toEqual(behavior.duplicateSuffix);
	});

	it("M6: already-migrated choice preserved", async () => {
		const choice = await readChoice("__qa-test-m6-already");
		expect(choice?.fileExistsBehavior).toEqual(behavior.overwrite);
	});

	it("migration flag set to true", async () => {
		const data = await qa.data<QuickAddData>().read();
		expect(data.migrations.consolidateFileExistsBehavior).toBe(true);
	});
});
