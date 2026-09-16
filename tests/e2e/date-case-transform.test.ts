import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const CHOICE_ID = "__qa-1667-date-case";
const COMMAND_ID = `quickadd:choice:${CHOICE_ID}`;
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const DAILY_NOTE = "Daily/date-case.md";
const CAPTURE_LINE = "- captured through issue 1667";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
};

function captureChoice(targetPath: string) {
	return {
		id: CHOICE_ID,
		name: CHOICE_ID,
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
		format: { enabled: true, format: "- captured through issue 1667" },
		prepend: false,
		appendLink: false,
		task: false,
		insertAfter: {
			enabled: true,
			after: "## {{DATE:dddd, MMMM Do, yyyy.|case:lower}}",
			inline: false,
			replaceExisting: false,
			insertAtEnd: false,
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
		testName: "date-case-transform",
	});

	const targetPath = await seedVaultFile(obsidian, sandbox, DAILY_NOTE);

	await qa.data<QuickAddData>().patch((data) => {
		data.choices = data.choices.filter((choice) => choice.id !== CHOICE_ID);
		data.choices.push(captureChoice(targetPath));
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

async function resetDailyNote() {
	const heading = await obsidian.dev.evalJson<string>(
		'window.moment(new Date()).format("dddd, MMMM Do, yyyy.").toLowerCase()',
	);
	const prefix = `# Daily note\n\n## ${heading}\n\n`;
	await seedVaultFile(obsidian, sandbox, DAILY_NOTE, `${prefix}Existing entry\n`);
	return `${prefix}${CAPTURE_LINE}\nExisting entry\n`;
}

describe("issue 1667: date case transform in Insert after", () => {
	it("captures under the exact lowercase heading from the CLI and a hotkey", async (ctx) => {
		ctx.onTestFailed(async () => {
			await captureFailureArtifacts(
				{ id: ctx.task.id, name: ctx.task.name },
				obsidian,
				{ plugin: qa, captureOnFailure: true },
			);
		});

		const expectedCliContent = await resetDailyNote();
		const outcome = await obsidian.execJson<{
			ok: boolean;
			verified?: boolean;
			effect?: string;
		}>("quickadd:run", { choice: CHOICE_ID, verify: true });
		const content = await sandbox.waitForContent(
			DAILY_NOTE,
			(text) => text.includes("- captured through issue 1667"),
			WAIT_OPTS,
		);

		expect(outcome).toMatchObject({
			ok: true,
			verified: true,
			effect: "changed",
		});
		expect(content).toBe(expectedCliContent);

		const expectedHotkeyContent = await resetDailyNote();

		const hotkeyResult = await obsidian.dev.evalJson<{
			commandRegistered: boolean;
			defaultPrevented: boolean;
		}>(`(() => {
			const commandId = ${JSON.stringify(COMMAND_ID)};
			const previous = app.hotkeyManager.getHotkeys(commandId) ?? [];
			const hotkey = { modifiers: ["Mod", "Shift", "Alt"], key: "J" };
			app.hotkeyManager.setHotkeys(commandId, [hotkey]);
			try {
				const event = new KeyboardEvent("keydown", {
					key: "j",
					code: "KeyJ",
					metaKey: /Mac|iPhone|iPad|iPod/.test(navigator.platform),
					ctrlKey: !/Mac|iPhone|iPad|iPod/.test(navigator.platform),
					shiftKey: true,
					altKey: true,
					bubbles: true,
					cancelable: true,
				});
				document.body.dispatchEvent(event);
				return {
					commandRegistered: Boolean(app.commands.commands[commandId]),
					defaultPrevented: event.defaultPrevented,
				};
			} finally {
				if (previous.length > 0) {
					app.hotkeyManager.setHotkeys(commandId, previous);
				} else {
					app.hotkeyManager.removeHotkeys(commandId);
				}
			}
		})()`);
		const hotkeyContent = await sandbox.waitForContent(
			DAILY_NOTE,
			(text) => text.includes("- captured through issue 1667"),
			WAIT_OPTS,
		);

		expect(hotkeyResult).toEqual({
			commandRegistered: true,
			defaultPrevented: true,
		});
		expect(hotkeyContent).toBe(expectedHotkeyContent);
	});
});
