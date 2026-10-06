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
import { waitForElement } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

const PLUGIN_ID = "quickadd";
const CHOICE_ID = "__qa-1987-heading-picker";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const NOTE = "Picker.md";
const NOTE_CONTENT =
	"---\ntags: log\n# owner: me\n---\n## Log\n- first entry\n\n```md\n# comment\n## Next\n```\n\n####### seven\n## Next\n";
const EXPECTED =
	"---\ntags: log\n# owner: me\n---\n## Log\n- first entry\n\n```md\n# comment\n## Next\n```\n\n####### seven\n## Next\n- captured";

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
			after: "",
			inline: false,
			replaceExisting: false,
			insertAtEnd: false,
			considerSubsections: false,
			blankLineAfterMatchMode: "auto",
			promptHeading: true,
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
		testName: "capture-heading-picker",
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
		// A failed assertion leaves the heading picker open for the next spec.
		() =>
			obsidian?.dev.evalJson<boolean>(`(() => {
				document.querySelectorAll(".modal-container").forEach((el) =>
					el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
				);
				return true;
			})()`),
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

describe("issue 1987: Choose heading when capturing", () => {
	beforeEach((ctx) => {
		registerFailureArtifacts(ctx, obsidian, { captureOnFailure: true }, qa);
	});

	it("offers the headings Obsidian shows, and captures under the picked one", async () => {
		await seedVaultFile(obsidian, sandbox, NOTE, NOTE_CONTENT);

		await obsidian.dev.evalJson<boolean>(`(() => {
			app.commands.executeCommandById(${JSON.stringify(`quickadd:choice:${CHOICE_ID}`)});
			return true;
		})()`);
		await waitForElement(obsidian, ".suggestion-item");
		const offered = await obsidian.dev.evalJson<string[]>(
			'[...document.querySelectorAll(".suggestion-item")].map((item) => item.textContent)',
		);
		expect(offered).toEqual(["  Log", "  Next"]);

		await obsidian.dev.evalJson<boolean>(`(() => {
			const next = [...document.querySelectorAll(".suggestion-item")]
				.find((item) => item.textContent === "  Next");
			next.click();
			return true;
		})()`);
		const content = await sandbox.waitForContent(
			NOTE,
			(text) => text.includes("- captured"),
			WAIT_OPTS,
		);
		expect(content).toBe(EXPECTED);
	});
});
