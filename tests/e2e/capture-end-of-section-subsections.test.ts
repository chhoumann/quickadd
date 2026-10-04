import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	clearVaultRunLockMarker,
	createSandboxApi,
} from "obsidian-e2e";
import { registerFailureArtifacts } from "obsidian-e2e/vitest";
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
import { withStoredChoices } from "./storedChoices";

const PLUGIN_ID = "quickadd";
const CHOICE_ID = "__qa-2029-end-of-section-subsections";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const NOTE = "Headers.md";
const NOTE_CONTENT =
	"# Header one\n## Pre-existing header\nPre-existing text\n# Header two\n";
const EXPECTED =
	"# Header one\n## Pre-existing header\nPre-existing text\n## Capture header\nSome capture text\n# Header two\n";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
};

function captureChoice(id: string, targetPath: string) {
	return {
		id,
		name: id,
		type: "Capture",
		command: true,
		captureTo: targetPath,
		captureToActiveFile: false,
		activeFileWritePosition: "cursor",
		createFileIfItDoesntExist: {
			enabled: false,
			createWithTemplate: false,
			template: "",
		},
		format: { enabled: true, format: "## Capture header\nSome capture text" },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: true,
			after: "# Header one",
			inline: false,
			replaceExisting: false,
			insertAtEnd: true,
			considerSubsections: true,
			blankLineAfterMatchMode: "auto",
			promptHeading: false,
			createIfNotFound: false,
			createIfNotFoundLocation: "top",
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

beforeAll(async () => {
	obsidian = createQuickAddObsidianClient();
	lock = await acquireQuickAddVaultRunLock(obsidian);
	await lock.publishMarker(obsidian);

	qa = obsidian.plugin(PLUGIN_ID);
	sandbox = await createSandboxApi({
		obsidian,
		sandboxRoot: "__obsidian_e2e__",
		testName: "capture-end-of-section-subsections",
	});

	const targetPath = await seedVaultFile(obsidian, sandbox, NOTE, NOTE_CONTENT);

	await qa.data<QuickAddData>().patch(withStoredChoices((data) => {
		data.choices = data.choices.filter((choice) => choice.id !== CHOICE_ID);
		data.choices.push(captureChoice(CHOICE_ID, targetPath));
	}));
	await qa.reload({ waitUntilReady: true });
}, 30_000);

afterAll(async () => {
	const errors: unknown[] = [];
	for (const step of [
		() => qa?.restoreData?.(),
		() => qa?.reload?.(),
		() => sandbox?.cleanup?.(),
		() => (obsidian ? clearVaultRunLockMarker(obsidian) : undefined),
		() => lock?.release(),
	]) {
		try {
			await step();
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length > 0) throw errors[0];
}, 15_000);

describe("issue 2029: Insert at end of section with Consider subsections", () => {
	beforeEach((ctx) => {
		registerFailureArtifacts(ctx, obsidian, { captureOnFailure: true }, qa);
	});

	it("writes below the subsection's text when the next heading follows it at once", async () => {
		const outcome = await obsidian.execJson<{ ok: boolean }>("quickadd:run", {
			choice: CHOICE_ID,
		});
		const content = await sandbox.waitForContent(
			NOTE,
			(text) => text.includes("Some capture text"),
			WAIT_OPTS,
		);

		expect(outcome).toMatchObject({ ok: true });
		expect(content).toBe(EXPECTED);
	});
});
