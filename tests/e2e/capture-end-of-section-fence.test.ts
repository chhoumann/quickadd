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

const PLUGIN_ID = "quickadd";
const CHOICE_ID = "__qa-1968-end-of-section-fence";
const SUBSECTIONS_CHOICE_ID = `${CHOICE_ID}-subsections`;
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const NOTE = "Log.md";
const NOTE_CONTENT =
	"## Log\n- first entry\n\n```bash\n# comment\necho hi\n```\n\n- second entry\n\n## Next\n- untouched\n";
const EXPECTED =
	"## Log\n- first entry\n\n```bash\n# comment\necho hi\n```\n\n- second entry\n- captured\n\n## Next\n- untouched\n";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
};

function captureChoice(id: string, targetPath: string, considerSubsections: boolean) {
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
			after: "## Log",
			inline: false,
			replaceExisting: false,
			insertAtEnd: true,
			considerSubsections,
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
		testName: "capture-end-of-section-fence",
	});

	const targetPath = await seedVaultFile(obsidian, sandbox, NOTE, NOTE_CONTENT);

	await qa.data<QuickAddData>().patch((data) => {
		data.choices = data.choices.filter(
			(choice) => choice.id !== CHOICE_ID && choice.id !== SUBSECTIONS_CHOICE_ID,
		);
		data.choices.push(
			captureChoice(CHOICE_ID, targetPath, false),
			captureChoice(SUBSECTIONS_CHOICE_ID, targetPath, true),
		);
	});
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

describe("issue 1968: Insert at end of section with a code fence in the section", () => {
	beforeEach((ctx) => {
		registerFailureArtifacts(ctx, obsidian, { captureOnFailure: true }, qa);
	});

	it.each([CHOICE_ID, SUBSECTIONS_CHOICE_ID])(
		"writes %s below the section's last entry, not at the # line in the fence",
		async (choiceId) => {
			await seedVaultFile(obsidian, sandbox, NOTE, NOTE_CONTENT);

			const outcome = await obsidian.execJson<{ ok: boolean }>("quickadd:run", {
				choice: choiceId,
			});
			const content = await sandbox.waitForContent(
				NOTE,
				(text) => text.includes("- captured"),
				WAIT_OPTS,
			);

			expect(outcome).toMatchObject({ ok: true });
			expect(content).toBe(EXPECTED);
		},
	);
});
