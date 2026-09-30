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

const PLUGIN_ID = "quickadd";
const CHOICE_ID = "__qa-2022-crlf-headings";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const SUBSECTIONS_CHOICE_ID = `${CHOICE_ID}-subsections`;
const NOTE = "Crlf.md";
const NOTE_CONTENT =
	"## Log\r\n- first\r\n\r\n### Sub\r\n- sub\r\n\r\n## Next\r\n- untouched\r\n";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
};

function captureChoice(id: string, targetPath: string, picker: boolean) {
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
			after: picker ? "" : "## Log",
			inline: false,
			replaceExisting: false,
			insertAtEnd: !picker,
			considerSubsections: !picker,
			blankLineAfterMatchMode: "auto",
			promptHeading: picker,
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
		testName: "capture-crlf-headings",
	});

	const targetPath = await seedVaultFile(obsidian, sandbox, NOTE, NOTE_CONTENT);

	await qa.data<QuickAddData>().patch((data) => {
		data.choices = data.choices.filter(
			(choice) => choice.id !== CHOICE_ID && choice.id !== SUBSECTIONS_CHOICE_ID,
		);
		data.choices.push(
			captureChoice(CHOICE_ID, targetPath, true),
			captureChoice(SUBSECTIONS_CHOICE_ID, targetPath, false),
		);
	});
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

describe("issue 2022: headings in a CRLF note", () => {
	beforeEach((ctx) => {
		registerFailureArtifacts(ctx, obsidian, { captureOnFailure: true }, qa);
	});

	async function seedCrlfNote() {
		await seedVaultFile(obsidian, sandbox, NOTE, NOTE_CONTENT);
		const seeded = await sandbox.waitForContent(NOTE, (text) => text.includes("## Log"), WAIT_OPTS);
		expect(seeded).toBe(NOTE_CONTENT);
	}

	it("ends a section after its subsections", async () => {
		await seedCrlfNote();

		const outcome = await obsidian.execJson<{ ok: boolean }>("quickadd:run", {
			choice: SUBSECTIONS_CHOICE_ID,
		});
		const content = await sandbox.waitForContent(
			NOTE,
			(text) => text.includes("- captured"),
			WAIT_OPTS,
		);

		expect(outcome).toMatchObject({ ok: true });
		const at = content.indexOf("- captured");
		expect(at).toBeGreaterThan(content.indexOf("- sub"));
		expect(at).toBeLessThan(content.indexOf("## Next"));
	});

	it("offers the note's headings in the heading picker", async () => {
		await seedCrlfNote();

		await obsidian.dev.evalJson<boolean>(`(() => {
			app.commands.executeCommandById(${JSON.stringify(`quickadd:choice:${CHOICE_ID}`)});
			return true;
		})()`);
		await waitForElement(obsidian, ".suggestion-item");
		const offered = await obsidian.dev.evalJson<string[]>(
			'[...document.querySelectorAll(".suggestion-item")].map((item) => item.textContent)',
		);
		expect(offered).toEqual(["  Log", "    Sub", "  Next"]);

		await obsidian.dev.evalJson<boolean>(`(() => {
			const sub = [...document.querySelectorAll(".suggestion-item")]
				.find((item) => item.textContent === "    Sub");
			sub.click();
			return true;
		})()`);
		const content = await sandbox.waitForContent(
			NOTE,
			(text) => text.includes("- captured"),
			WAIT_OPTS,
		);
		const at = content.indexOf("- captured");
		expect(at).toBeGreaterThan(content.indexOf("### Sub"));
		expect(at).toBeLessThan(content.indexOf("- sub"));
	});
});
