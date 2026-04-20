import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	acquireVaultRunLock,
	captureFailureArtifacts,
	clearVaultRunLockMarker,
	createObsidianClient,
	createSandboxApi,
} from "obsidian-e2e";
import type {
	ObsidianClient,
	PluginHandle,
	SandboxApi,
	VaultRunLock,
} from "obsidian-e2e";

const VAULT = "dev";
const PLUGIN_ID = "quickadd";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const TEST_PREFIX = "__qa-test-1165-";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;
let lock: VaultRunLock | undefined;

type QuickAddData = {
	choices: Record<string, unknown>[];
	migrations: Record<string, boolean>;
};

type LayoutResult = {
	ok?: boolean;
	error?: string;
	leftLeafId?: string;
	leftParentId?: string | null;
	leftPinned?: boolean;
	rightLeafId?: string;
	rightParentId?: string | null;
};

type OpenResult = {
	activeFile: string | null;
	activeLeafId: string | null;
	origin: {
		id: string | null;
		pinned: boolean;
		parentId: string | null;
	};
	targetLeaf: {
		id: string | null;
		file: string | null;
		pinned: boolean;
		parentId: string | null;
	} | null;
	targetTabsInOriginGroup: number;
};

type ScenarioResult = OpenResult & {
	rightParentId: string | null;
};

function macroOpenFileChoice(id: string, targetPath: string, location: "tab" | "reuse") {
	return {
		id,
		name: id,
		type: "Macro",
		command: true,
		runOnStartup: false,
		macro: {
			id,
			name: id,
			commands: [
				{
					id: `${id}-open-file`,
					name: `Open ${targetPath}`,
					type: "OpenFile",
					filePath: targetPath,
					location,
					focus: true,
					openInNewTab: false,
				},
			],
		},
	};
}

function clearTestChoices(data: QuickAddData) {
	data.choices = data.choices.filter(
		(choice) => !String(choice.id ?? "").startsWith(TEST_PREFIX),
	);
}

async function seedFile(path: string, content: string) {
	await sandbox.write(path, content, {
		waitForContent: true,
		waitOptions: WAIT_OPTS,
	});
}

async function waitForEvalResult<T extends { ok?: boolean; error?: string }>(
	globalName: string,
): Promise<T> {
	const result = await obsidian.waitFor(async () => {
		const value = await obsidian.dev.evalJson<T | null>(
			`window.${globalName} ?? null`,
		);
		return value?.ok || value?.error ? value : false;
	}, WAIT_OPTS);

	if (result.error) throw new Error(result.error);
	return result;
}

function setupPinnedOriginLayoutCode({
	leftPath,
	rightPath,
	globalName,
}: {
	leftPath: string;
	rightPath: string;
	globalName: string;
}) {
	return `
window.${globalName} = { ok: false };
(async () => {
	try {
		const getFile = (path) => {
			const file = app.vault.getAbstractFileByPath(path);
			if (!file) throw new Error(\`Missing file: \${path}\`);
			return file;
		};

		const leftFile = getFile(${JSON.stringify(leftPath)});
		const rightFile = getFile(${JSON.stringify(rightPath)});

		const leftLeaf = app.workspace.getLeaf(false);
		await leftLeaf.openFile(leftFile);
		leftLeaf.setPinned(true);
		app.workspace.setActiveLeaf(leftLeaf, { focus: true });

		const rightLeaf = app.workspace.getLeaf("split", "vertical");
		await rightLeaf.openFile(rightFile);
		rightLeaf.setPinned(false);

		app.workspace.setActiveLeaf(leftLeaf, { focus: true });
		window.${globalName} = {
			ok: true,
			leftLeafId: leftLeaf.id ?? null,
			leftParentId: leftLeaf.parent?.id ?? null,
			leftPinned: !!leftLeaf.pinned || !!leftLeaf.getViewState?.()?.pinned,
			rightLeafId: rightLeaf.id ?? null,
			rightParentId: rightLeaf.parent?.id ?? null,
		};
	} catch (error) {
		window.${globalName} = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
})();
"started";
`;
}

function inspectOpenResultCode({
	originLeafId,
	originParentId,
	originPinned,
	targetPath,
}: {
	originLeafId: string;
	originParentId: string | null;
	originPinned: boolean;
	targetPath: string;
}) {
	return `
(() => {
	const leafInfo = (leaf) => {
		if (!leaf) return null;
		const viewState = leaf.getViewState?.();
		return {
			id: leaf.id ?? null,
			file: leaf.view?.file?.path ?? viewState?.state?.file ?? null,
			pinned: !!leaf.pinned || !!viewState?.pinned,
			parentId: leaf.parent?.id ?? null,
		};
	};
	const leaves = [];
	app.workspace.iterateAllLeaves((leaf) => leaves.push(leaf));
	const originParentId = ${JSON.stringify(originParentId)};
	const targetPath = ${JSON.stringify(targetPath)};
	const targetLeaves = leaves.filter((leaf) => {
		const viewState = leaf.getViewState?.();
		return leaf.view?.file?.path === targetPath || viewState?.state?.file === targetPath;
	});
	const activeLeaf = app.workspace.activeLeaf ?? null;
	const activeViewState = activeLeaf?.getViewState?.();
	const activeLeafShowsTarget =
		activeLeaf?.view?.file?.path === targetPath || activeViewState?.state?.file === targetPath;
	const targetLeaf = activeLeafShowsTarget
		? activeLeaf
		: targetLeaves.find((leaf) => (leaf.parent?.id ?? null) !== originParentId) ??
			targetLeaves[0] ??
			null;

	return {
		activeFile: app.workspace.getActiveFile()?.path ?? null,
		activeLeafId: app.workspace.activeLeaf?.id ?? null,
		origin: {
			id: ${JSON.stringify(originLeafId)},
			pinned: ${JSON.stringify(originPinned)},
			parentId: originParentId,
		},
		targetLeaf: leafInfo(targetLeaf),
		targetTabsInOriginGroup: targetLeaves.filter((leaf) => (leaf.parent?.id ?? null) === originParentId).length,
	};
})()
`;
}

async function runOpenFileScenario(
	location: "tab" | "reuse",
): Promise<ScenarioResult> {
	const id = `${TEST_PREFIX}${location}`;
	const leftPath = sandbox.path(`${location}-left-locked.md`);
	const rightPath = sandbox.path(`${location}-right-unlocked.md`);
	const targetPath = sandbox.path(`${location}-target.md`);
	const layoutGlobal = `__qa1165Layout_${location}`;

	await seedFile(`${location}-left-locked.md`, `${location.toUpperCase()} LEFT`);
	await seedFile(`${location}-right-unlocked.md`, `${location.toUpperCase()} RIGHT`);
	await seedFile(`${location}-target.md`, `${location.toUpperCase()} TARGET`);

	await qa.data<QuickAddData>().patch((data) => {
		clearTestChoices(data);
		data.choices.push(macroOpenFileChoice(id, targetPath, location));
	});
	await qa.reload({ waitUntilReady: true });

	await obsidian.dev.evalRaw(
		setupPinnedOriginLayoutCode({ leftPath, rightPath, globalName: layoutGlobal }),
	);
	const layout = await waitForEvalResult<LayoutResult>(layoutGlobal);
	expect(layout.leftLeafId).toBeTruthy();
	expect(layout.leftPinned).toBe(true);
	expect(layout.rightParentId).toBeTruthy();

	await obsidian.command(`quickadd:choice:${id}`).run();
	await obsidian.waitFor(async () => {
		const result = await obsidian.dev.evalJson<OpenResult>(
			inspectOpenResultCode({
				originLeafId: layout.leftLeafId as string,
				originParentId: layout.leftParentId ?? null,
				originPinned: layout.leftPinned ?? false,
				targetPath,
			}),
		);
		return result.activeFile === targetPath ? result : false;
	}, WAIT_OPTS);

	const result = await obsidian.dev.evalJson<OpenResult>(
		inspectOpenResultCode({
			originLeafId: layout.leftLeafId as string,
			originParentId: layout.leftParentId ?? null,
			originPinned: layout.leftPinned ?? false,
			targetPath,
		}),
	);

	return {
		...result,
		rightParentId: layout.rightParentId ?? null,
	};
}

async function runTeardownStep(
	label: string,
	step: () => Promise<unknown> | unknown,
	errors: unknown[],
) {
	try {
		await step();
	} catch (error) {
		errors.push(error);
		console.warn(`locked-leaf-file-opening teardown failed during ${label}`, error);
	}
}

beforeAll(async () => {
	obsidian = createObsidianClient({ vault: VAULT });
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
		testName: "locked-leaf-file-opening",
	});
}, 30_000);

afterAll(async () => {
	const errors: unknown[] = [];

	await runTeardownStep("restoreData", () => qa?.restoreData?.(), errors);
	await runTeardownStep("reload", () => qa?.reload?.(), errors);
	await runTeardownStep("sandbox cleanup", () => sandbox?.cleanup?.(), errors);
	await runTeardownStep(
		"clear vault run lock marker",
		() => (obsidian ? clearVaultRunLockMarker(obsidian) : undefined),
		errors,
	);
	await runTeardownStep("release vault lock", () => lock?.release(), errors);

	if (errors.length > 0) {
		throw errors[0];
	}
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

describe("issue 1165: file opening from locked split panes", () => {
	it("routes tab opens from a pinned origin into the unlocked split", async () => {
		const result = await runOpenFileScenario("tab");

		expect(result.origin).toMatchObject({ pinned: true });
		expect(result.targetLeaf).toMatchObject({ pinned: false });
		expect(result.targetLeaf?.parentId).toBe(result.rightParentId);
		expect(result.targetLeaf?.parentId).not.toBe(result.origin.parentId);
		expect(result.targetTabsInOriginGroup).toBe(0);
	});

	it("routes reuse opens from a pinned origin into the unlocked split", async () => {
		const result = await runOpenFileScenario("reuse");

		expect(result.origin).toMatchObject({ pinned: true });
		expect(result.targetLeaf).toMatchObject({ pinned: false });
		expect(result.targetLeaf?.parentId).toBe(result.rightParentId);
		expect(result.targetLeaf?.parentId).not.toBe(result.origin.parentId);
		expect(result.targetTabsInOriginGroup).toBe(0);
	});
});
