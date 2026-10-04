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
const CHOICE_ID = "__qa-end-of-section-comment-math";
const SUBSECTIONS_CHOICE_ID = `${CHOICE_ID}-math`;
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const NOTES: Record<string, { path: string; block: string }> = {
	[CHOICE_ID]: { path: "Comment.md", block: "%%\n# draft idea\n%%" },
	[SUBSECTIONS_CHOICE_ID]: { path: "Math.md", block: "$$\n# x = 1\n$$" },
};
const noteContent = (block: string) => `## Log\n- first\n\n${block}\n- second\n\n## Next\n`;
const expected = (block: string) =>
	`## Log\n- first\n\n${block}\n- second\n- captured\n\n## Next\n`;

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
			after: "## Log",
			inline: false,
			replaceExisting: false,
			insertAtEnd: true,
			considerSubsections: false,
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
		testName: "capture-end-of-section-comment-math",
	});

	const commentPath = await seedVaultFile(obsidian, sandbox, NOTES[CHOICE_ID].path);
	const mathPath = await seedVaultFile(obsidian, sandbox, NOTES[SUBSECTIONS_CHOICE_ID].path);

	await qa.data<QuickAddData>().patch(withStoredChoices((data) => {
		data.choices = data.choices.filter(
			(choice) => choice.id !== CHOICE_ID && choice.id !== SUBSECTIONS_CHOICE_ID,
		);
		data.choices.push(
			captureChoice(CHOICE_ID, commentPath),
			captureChoice(SUBSECTIONS_CHOICE_ID, mathPath),
		);
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

describe("Insert at end of section with a # line in a %% or $$ block", () => {
	beforeEach((ctx) => {
		registerFailureArtifacts(ctx, obsidian, { captureOnFailure: true }, qa);
	});

	it.each([CHOICE_ID, SUBSECTIONS_CHOICE_ID])(
		"writes %s below the section's last entry, not inside the block",
		async (choiceId) => {
			const { path, block } = NOTES[choiceId];
			await seedVaultFile(obsidian, sandbox, path, noteContent(block));

			const outcome = await obsidian.execJson<{ ok: boolean }>("quickadd:run", {
				choice: choiceId,
			});
			const content = await sandbox.waitForContent(
				path,
				(text) => text.includes("- captured"),
				WAIT_OPTS,
			);

			expect(outcome).toMatchObject({ ok: true });
			expect(content).toBe(expected(block));
		},
	);
});
