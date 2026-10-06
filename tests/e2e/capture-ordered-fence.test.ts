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
const CHOICE_ID = "__qa-2001-ordered-fence";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const NOTE = "Journal.md";
const NOTE_CONTENT = "# Journal\n```inline```\n\n## 2026-06-16\n- entry\n";
const EXPECTED = "# Journal\n```inline```\n\n## 2026-06-16\n- entry\n- captured";

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
		format: { enabled: true, format: "- captured" },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: true,
			after: "## 2026-06-16",
			inline: false,
			replaceExisting: false,
			insertAtEnd: true,
			considerSubsections: false,
			blankLineAfterMatchMode: "auto",
			promptHeading: false,
			createIfNotFound: true,
			createIfNotFoundLocation: "ordered",
			orderBy: { by: "date", dateFormat: "YYYY-MM-DD", direction: "desc", unparseable: "bottom" },
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
		testName: "capture-ordered-fence",
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

describe("issue 2001: ordered Create line if not found after an inline-code line", () => {
	beforeEach((ctx) => {
		registerFailureArtifacts(ctx, obsidian, { captureOnFailure: true }, qa);
	});

	it("writes under the existing heading instead of creating a second one", async () => {
		await seedVaultFile(obsidian, sandbox, NOTE, NOTE_CONTENT);

		const outcome = await obsidian.execJson<{ ok: boolean }>("quickadd:run", {
			choice: CHOICE_ID,
		});
		const content = await sandbox.waitForContent(
			NOTE,
			(text) => text.includes("- captured"),
			WAIT_OPTS,
		);

		expect(outcome).toMatchObject({ ok: true });
		expect(content).toBe(EXPECTED);
	});
});
