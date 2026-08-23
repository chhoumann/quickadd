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
	PLUGIN_ID,
	seedVaultFile,
} from "./e2eVault";

const WAIT_OPTS = { timeoutMs: 15_000, intervalMs: 200 };
const TPL_CONTENT = "QA_1674_TEMPLATE";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
};

function templateChoice(spec: {
	id: string;
	folderEnabled: boolean;
	folders: string[];
	fileNameFormat: string;
}) {
	return {
		id: spec.id,
		name: spec.id,
		type: "Template",
		command: false,
		templatePath: sandbox.path("tpl.md"),
		fileNameFormat: { enabled: true, format: spec.fileNameFormat },
		folder: {
			enabled: spec.folderEnabled,
			folders: spec.folders,
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
		fileExistsBehavior: { kind: "apply", mode: "increment" },
	};
}

async function openNote(vaultRelativePath: string): Promise<string | null> {
	return obsidian.dev.evalJsonAsync<string | null>(
		`(async () => {
			const file = app.vault.getAbstractFileByPath(${JSON.stringify(vaultRelativePath)});
			if (!file) throw new Error("note not found: " + ${JSON.stringify(vaultRelativePath)});
			const leaf = app.workspace.getLeaf(false);
			await leaf.openFile(file);
			app.workspace.setActiveLeaf(leaf, { focus: true });
			return app.workspace.getActiveFile()?.path ?? null;
		})()`,
	);
}

beforeAll(async () => {
	obsidian = createQuickAddObsidianClient();
	lock = await acquireQuickAddVaultRunLock(obsidian);
	await lock.publishMarker(obsidian);

	qa = obsidian.plugin(PLUGIN_ID);
	sandbox = await createSandboxApi({
		obsidian,
		sandboxRoot: "__obsidian_e2e__",
		testName: "filenamecurrent-nested-folder",
	});

	await seedVaultFile(obsidian, sandbox, "tpl.md", TPL_CONTENT);
	await seedVaultFile(
		obsidian,
		sandbox,
		"Projects/Project XYZ.md",
		"Active project note",
	);

	await qa.data<QuickAddData>().patch((data) => {
		data.choices = data.choices.filter(
			(choice) => !String(choice.id ?? "").startsWith("__qa-1674-"),
		);
		data.choices.push(
			templateChoice({
				id: "__qa-1674-case1",
				folderEnabled: true,
				folders: ["{{FOLDERCURRENT}}"],
				fileNameFormat: "{{FILENAMECURRENT}}/{{VALUE}}",
			}),
			templateChoice({
				id: "__qa-1674-case2",
				folderEnabled: true,
				folders: [sandbox.path("Use Cases")],
				fileNameFormat: "{{FILENAMECURRENT}}/{{VALUE}}",
			}),
		);
	});
	await qa.reload({ waitUntilReady: true });
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

describe("issue 1674: nest a new note under a folder named after the active file", () => {
	it("creates Projects/Project XYZ/Use Case 1.md from FOLDERCURRENT + FILENAMECURRENT/VALUE", async () => {
		const active = await openNote(sandbox.path("Projects/Project XYZ.md"));
		expect(active).toBe(sandbox.path("Projects/Project XYZ.md"));

		const result = await obsidian.execJson<{
			ok: boolean;
			file?: string;
			error?: string;
			effect?: string;
		}>("quickadd:run", {
			choice: "__qa-1674-case1",
			vars: JSON.stringify({ value: "Use Case 1" }),
			verify: true,
		});

		expect(result.ok, result.error).toBe(true);
		expect(result.file).toBe(sandbox.path("Projects/Project XYZ/Use Case 1.md"));
		const content = await sandbox.waitForContent(
			"Projects/Project XYZ/Use Case 1.md",
			(body) => body.includes(TPL_CONTENT),
			WAIT_OPTS,
		);
		expect(content).toContain(TPL_CONTENT);
	});

	it("creates Use Cases/Project XYZ/Use Case 1.md from a static folder + FILENAMECURRENT/VALUE", async () => {
		const active = await openNote(sandbox.path("Projects/Project XYZ.md"));
		expect(active).toBe(sandbox.path("Projects/Project XYZ.md"));

		const result = await obsidian.execJson<{
			ok: boolean;
			file?: string;
			error?: string;
		}>("quickadd:run", {
			choice: "__qa-1674-case2",
			vars: JSON.stringify({ value: "Use Case 1" }),
			verify: true,
		});

		expect(result.ok, result.error).toBe(true);
		expect(result.file).toBe(sandbox.path("Use Cases/Project XYZ/Use Case 1.md"));
		const content = await sandbox.waitForContent(
			"Use Cases/Project XYZ/Use Case 1.md",
			(body) => body.includes(TPL_CONTENT),
			WAIT_OPTS,
		);
		expect(content).toContain(TPL_CONTENT);
	});
});
