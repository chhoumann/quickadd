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
const TEST_PREFIX = "__qa-capture-cursor-";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
};

type CursorResult = {
	activeFile: string | null;
	content: string;
	cursor: { line: number; ch: number };
	selections: Array<{
		anchor: { line: number; ch: number };
		head: { line: number; ch: number };
	}>;
};

function clearTestChoices(data: QuickAddData) {
	data.choices = data.choices.filter(
		(choice) => !String(choice.id ?? "").startsWith(TEST_PREFIX),
	);
}

function captureChoice({
	id,
	content,
	newLineCapture,
}: {
	id: string;
	content: string;
	newLineCapture?: { enabled: boolean; direction: "above" | "below" };
}) {
	return {
		id,
		name: id,
		type: "Capture",
		command: false,
		captureTo: "",
		captureToActiveFile: true,
		activeFileWritePosition: "cursor",
		createFileIfItDoesntExist: {
			enabled: false,
			createWithTemplate: false,
			template: "",
		},
		format: { enabled: true, format: content },
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
		newLineCapture: newLineCapture ?? { enabled: false, direction: "below" },
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: false,
		},
	};
}

async function seedChoices() {
	await qa.data<QuickAddData>().patch((data) => {
		clearTestChoices(data);
		data.choices.push(
			captureChoice({
				id: `${TEST_PREFIX}current-line`,
				content: "CAPTURED ",
			}),
			captureChoice({
				id: `${TEST_PREFIX}above`,
				content: "A\nABOVE-2",
				newLineCapture: { enabled: true, direction: "above" },
			}),
			captureChoice({
				id: `${TEST_PREFIX}below`,
				content: "BELOW-1\nBELOW-2",
				newLineCapture: { enabled: true, direction: "below" },
			}),
		);
	});
	await qa.reload();
}

async function openNoteAtCursor(
	notePath: string,
	content: string,
	cursor: { line: number; ch: number },
) {
	await obsidian.dev.evalRaw(`(async () => {
		window.__qaCaptureCursorReady = false;
		const path = ${JSON.stringify(notePath)};
		let file = app.vault.getAbstractFileByPath(path);
		if (file) await app.vault.modify(file, ${JSON.stringify(content)});
		else file = await app.vault.create(path, ${JSON.stringify(content)});
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(file);
		app.workspace.setActiveLeaf(leaf, { focus: true });
		await new Promise((resolve) => setTimeout(resolve, 100));
		leaf.view.editor.setCursor(${JSON.stringify(cursor)});
		window.__qaCaptureCursorReady = true;
	})()`);

	await obsidian.waitFor(
		() => obsidian.dev.evalJson<boolean>("window.__qaCaptureCursorReady === true"),
		WAIT_OPTS,
	);
}

async function inspectEditor(): Promise<CursorResult> {
	return await obsidian.dev.evalJson<CursorResult>(`(() => {
		const view = app.workspace.activeLeaf.view;
		return {
			activeFile: app.workspace.getActiveFile()?.path ?? null,
			content: view.editor.getValue(),
			cursor: view.editor.getCursor(),
			selections: view.editor.listSelections(),
		};
	})()`);
}

async function runCapture(choice: string) {
	await obsidian.exec("quickadd:run", { choice });
}

beforeAll(async () => {
	obsidian = createQuickAddObsidianClient();
	lock = await acquireQuickAddVaultRunLock(obsidian);
	await lock.publishMarker(obsidian);

	qa = obsidian.plugin(PLUGIN_ID);
	sandbox = await createSandboxApi({
		obsidian,
		sandboxRoot: "__obsidian_e2e__",
		testName: "capture-cursor-position",
	});

	await seedChoices();
}, 60_000);

afterAll(async () => {
	const errors: unknown[] = [];

	await qa?.restoreData?.().catch((error) => errors.push(error));
	await qa?.reload?.().catch((error) => errors.push(error));
	await sandbox?.cleanup?.().catch((error) => errors.push(error));
	await (obsidian
		? clearVaultRunLockMarker(obsidian).catch((error) => errors.push(error))
		: undefined);
	await lock?.release?.().catch((error) => errors.push(error));

	if (errors.length > 0) {
		throw errors[0];
	}
}, 30_000);

beforeEach((ctx) => {
	ctx.onTestFailed(async () => {
		await captureFailureArtifacts(
			{ id: ctx.task.id, name: ctx.task.name },
			obsidian,
			{ plugin: qa, captureOnFailure: true },
		);
	});
});

describe("Capture active-file cursor position", () => {
	it("keeps the cursor at the capture position after current-line insertion", async () => {
		const note = sandbox.path("current-line.md");
		await openNoteAtCursor(note, "alpha beta", { line: 0, ch: 6 });

		await runCapture(`${TEST_PREFIX}current-line`);

		const result = await inspectEditor();
		expect(result.activeFile).toBe(note);
		expect(result.content).toBe("alpha CAPTURED beta");
		expect(result.cursor).toEqual({ line: 0, ch: 6 });
		expect(result.selections).toEqual([
			{ anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 6 } },
		]);
	});

	it("keeps the cursor with the original line after inserting above", async () => {
		const note = sandbox.path("above.md");
		await openNoteAtCursor(note, "alpha\nbravo", { line: 1, ch: 4 });

		await runCapture(`${TEST_PREFIX}above`);

		const result = await inspectEditor();
		expect(result.activeFile).toBe(note);
		expect(result.content).toBe("alpha\nA\nABOVE-2\nbravo");
		expect(result.cursor).toEqual({ line: 3, ch: 4 });
	});

	it("keeps the cursor in place after inserting below", async () => {
		const note = sandbox.path("below.md");
		await openNoteAtCursor(note, "alpha\nbeta", { line: 0, ch: 2 });

		await runCapture(`${TEST_PREFIX}below`);

		const result = await inspectEditor();
		expect(result.activeFile).toBe(note);
		expect(result.content).toBe("alpha\nBELOW-1\nBELOW-2\nbeta");
		expect(result.cursor).toEqual({ line: 0, ch: 2 });
	});
});
