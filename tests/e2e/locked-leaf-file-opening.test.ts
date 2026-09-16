import { createSuiteLifecycle } from "./suiteLifecycle";
import { describe, expect, it } from "vitest";
import type {
	ObsidianClient,
	PluginHandle,
	SandboxApi,
} from "obsidian-e2e";
import {
	seedVaultFile,
} from "./e2eVault";

const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const TEST_PREFIX = "__qa-test-1165-";

let obsidian: ObsidianClient;
let sandbox: SandboxApi;
let qa: PluginHandle;

type QuickAddData = {
	choices: Record<string, unknown>[];
	migrations: Record<string, boolean>;
};

type LayoutResult = {
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
	await seedVaultFile(obsidian, sandbox, path, content);
}

function pinnedOriginLayoutCode({
	leftPath,
	rightPath,
}: {
	leftPath: string;
	rightPath: string;
}) {
	return `(async () => {
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
	return {
		leftLeafId: leftLeaf.id ?? null,
		leftParentId: leftLeaf.parent?.id ?? null,
		leftPinned: !!leftLeaf.pinned || !!leftLeaf.getViewState?.()?.pinned,
		rightLeafId: rightLeaf.id ?? null,
		rightParentId: rightLeaf.parent?.id ?? null,
	};
})()`;
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

	await seedFile(`${location}-left-locked.md`, `${location.toUpperCase()} LEFT`);
	await seedFile(`${location}-right-unlocked.md`, `${location.toUpperCase()} RIGHT`);
	await seedFile(`${location}-target.md`, `${location.toUpperCase()} TARGET`);

	await qa.data<QuickAddData>().patch((data) => {
		clearTestChoices(data);
		data.choices.push(macroOpenFileChoice(id, targetPath, location));
	});
	await qa.reload({ waitUntilReady: true });

	const layout = await obsidian.dev.evalJsonAsync<LayoutResult>(
		pinnedOriginLayoutCode({ leftPath, rightPath }),
	);
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

createSuiteLifecycle("locked-leaf-file-opening", (context) => {
	({ obsidian, sandbox, qa } = context);
});


describe("issue 1165: file opening from locked split panes", () => {
	it.each(["tab", "reuse"] as const)("routes %s opens from a pinned origin into the unlocked split", async (location) => {
		const result = await runOpenFileScenario(location);

		expect(result.origin).toMatchObject({ pinned: true });
		expect(result.targetLeaf).toMatchObject({ pinned: false });
		expect(result.targetLeaf?.parentId).toBe(result.rightParentId);
		expect(result.targetLeaf?.parentId).not.toBe(result.origin.parentId);
		expect(result.targetTabsInOriginGroup).toBe(0);
	});
});
