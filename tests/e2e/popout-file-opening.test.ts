import { afterEach, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS } from "./uiHelpers";

const getContext = createQuickAddE2EHarness("popout-file-opening");

type Layout = { main: string[]; popout: string[]; active: string | null };

/** Seeds a note; returns its vault path. */
async function note(name: string) {
	const { obsidian, sandbox } = getContext();
	return seedVaultFile(obsidian, sandbox, `${name}.md`, `# ${name}`);
}

/** A Template choice that opens its note in a new tab, registered as a command. */
async function saveTemplateChoice(targetPath: string) {
	const { plugin } = getContext();
	const choice = new TemplateChoice("Popout file opening");
	choice.command = true;
	choice.onePageInput = "never";
	choice.templatePath = await note("template");
	choice.fileNameFormat = { enabled: true, format: targetPath.slice(0, -3) };
	choice.fileExistsBehavior = { kind: "apply", mode: "overwrite" };
	choice.openFile = true;
	choice.fileOpening = { location: "tab", direction: "vertical", mode: "default", focus: true };
	await plugin.data<{ choices: IChoice[] }>().patch(data => { data.choices.push(choice); });
	await plugin.reload({ waitUntilReady: true });
	return choice;
}

/**
 * Lays out the main window, then opens `popoutPath` in a focused pop-out
 * window. `pinnedPath` is pinned and is the main window's last-used tab;
 * `unpinnedPath` is in a second tab group beside it.
 */
async function arrangeWindows(paths: { pinnedPath: string; unpinnedPath: string; popoutPath: string }) {
	const { obsidian } = getContext();
	await obsidian.dev.evalJsonAsync(`(async () => {
		const paths = ${JSON.stringify(paths)};
		const file = (path) => app.vault.getAbstractFileByPath(path);
		const pinned = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
		app.workspace.setActiveLeaf(pinned, { focus: true });
		await pinned.openFile(file(paths.pinnedPath));
		pinned.setPinned(true);
		await app.workspace.getLeaf("split", "vertical").openFile(file(paths.unpinnedPath));
		app.workspace.setActiveLeaf(pinned, { focus: true });
		// Obsidian orders leaves by the millisecond they were last activated.
		await sleep(20);
		const popout = app.workspace.openPopoutLeaf();
		await popout.openFile(file(paths.popoutPath));
		app.workspace.setActiveLeaf(popout, { focus: true });
		return true;
	})()`);
	await expect.poll(() => obsidian.dev.evalJson("activeDocument !== document"), POLL_OPTS).toBe(true);
}

/** The sandbox notes open in each window's tabs, and the active note. */
async function layout(): Promise<Layout> {
	const { obsidian, sandbox } = getContext();
	return obsidian.dev.evalJson<Layout>(`(() => {
		const prefix = ${JSON.stringify(sandbox.path("x").slice(0, -1))};
		const layout = { main: [], popout: [], active: app.workspace.getActiveFile()?.path.slice(prefix.length) ?? null };
		for (const leaf of app.workspace.getLeavesOfType("markdown")) {
			const path = leaf.view.file?.path;
			if (!path?.startsWith(prefix)) continue;
			const inMainWindow = leaf.getContainer() === app.workspace.rootSplit;
			layout[inMainWindow ? "main" : "popout"].push(path.slice(prefix.length));
		}
		return layout;
	})()`);
}

afterEach(async () => {
	const { obsidian, sandbox } = getContext();
	await obsidian.dev.evalJson(`(() => {
		for (const leaf of app.workspace.getLeavesOfType("markdown")) {
			if (!leaf.view.file?.path.startsWith(${JSON.stringify(sandbox.path(""))})) continue;
			leaf.setPinned(false);
			leaf.detach();
		}
		return true;
	})()`);
});

it("opens a Template choice's note in the pop-out window it ran from (#2282)", async () => {
	const { obsidian, sandbox } = getContext();
	const choice = await saveTemplateChoice(sandbox.path("created.md"));
	await arrangeWindows({
		pinnedPath: await note("main-pinned"),
		unpinnedPath: await note("main-unpinned"),
		popoutPath: await note("popout-origin"),
	});

	await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

	await expect.poll(layout, POLL_OPTS).toEqual({
		main: ["main-pinned.md", "main-unpinned.md"],
		popout: ["popout-origin.md", "created.md"],
		active: "created.md",
	});
});

it("focuses a note already open in the pop-out instead of opening it again", async () => {
	const { obsidian } = getContext();
	const existing = await note("already-open");
	const choice = await saveTemplateChoice(existing);
	await arrangeWindows({
		pinnedPath: await note("main-pinned"),
		unpinnedPath: await note("main-unpinned"),
		popoutPath: existing,
	});

	await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

	// The overwrite lands before the open step, so wait for it before reading tabs.
	await expect.poll(() => obsidian.dev.evalJsonAsync<string>(
		`app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(existing)}))`,
	), POLL_OPTS).toBe("# template");
	await expect.poll(layout, POLL_OPTS).toEqual({
		main: ["main-pinned.md", "main-unpinned.md"],
		popout: ["already-open.md"],
		active: "already-open.md",
	});
});
