import { describe, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import type IMacroChoice from "../../src/types/choices/IMacroChoice";
import type { IUserScript } from "../../src/types/macros/IUserScript";
import type { QuickAddPackage } from "../../src/types/packages/QuickAddPackage";
import { CommandType } from "../../src/types/macros/CommandType";
import { encodeToBase64 } from "../../src/utils/base64";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

// Pins what the import review's banner note claims (CapabilityBanner.svelte):
// an import's commands work straight away, and the only thing that waits for
// the next plugin load is a startup macro's automatic run.
const getContext = createQuickAddE2EHarness("package-import-activation");
const CHOICE_ID = "qa-e2e-import-activation";
const CHOICE_NAME = "Import activation check";
const COMMAND_ID = `quickadd:choice:${CHOICE_ID}`;
const RUN_LOG = "runs.md";
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

type QuickAddData = { choices: IChoice[] };

/** One macro that is both a palette command and a startup macro; each run appends a line to the log. */
function activationPackage(scriptPath: string, logPath: string): QuickAddPackage {
	const script = `module.exports = async ({ app }) => {
	const path = ${JSON.stringify(logPath)};
	const file = app.vault.getAbstractFileByPath(path);
	if (file) await app.vault.append(file, "run\\n");
	else await app.vault.create(path, "run\\n");
};`;
	const logRun: IUserScript = {
		id: `${CHOICE_ID}-script`,
		name: "logRun",
		type: CommandType.UserScript,
		path: scriptPath,
		settings: {},
	};
	const macro: IMacroChoice = {
		id: CHOICE_ID,
		name: CHOICE_NAME,
		type: "Macro",
		command: true,
		runOnStartup: true,
		macro: { id: `${CHOICE_ID}-body`, name: CHOICE_NAME, commands: [logRun] },
	};
	return {
		schemaVersion: 1,
		quickAddVersion: "2.28.0",
		createdAt: "2026-09-27T00:00:00.000Z",
		rootChoiceIds: [CHOICE_ID],
		choices: [{ choice: macro, pathHint: [CHOICE_NAME], parentChoiceId: null }],
		assets: [{
			kind: "user-script",
			originalPath: scriptPath,
			contentEncoding: "base64",
			content: encodeToBase64(script),
		}],
	};
}

describe("package import activation", () => {
	it("registers imported commands right away and leaves startup runs to the next load", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const scriptPath = sandbox.path("log-run.js");
		const packagePath = await seedVaultFile(
			obsidian,
			sandbox,
			"activation.quickadd.json",
			JSON.stringify(activationPackage(scriptPath, sandbox.path(RUN_LOG))),
		);
		// The import writes data.json through the plugin, which the harness does not
		// track. A no-op patch snapshots it so the per-test restore removes the macro.
		await plugin.data<QuickAddData>().patch(() => undefined);
		// Remember this plugin instance to prove no reload happens before the command runs.
		await obsidian.dev.evalJson<boolean>(
			"(() => { window.__qaImportActivation = app.plugins.plugins.quickadd; return true; })()",
		);

		try {
			const imported = await obsidian.execJson<{ ok: boolean; added?: string[]; writtenAssets?: string[] }>(
				"quickadd:package-import",
				{ path: packagePath, acknowledge: "true" },
			);
			expect(imported).toMatchObject({ ok: true, added: [CHOICE_ID], writtenAssets: [scriptPath] });

			expect(await obsidian.dev.evalJson<string | null>(
				`app.commands.commands[${JSON.stringify(COMMAND_ID)}]?.name ?? null`,
			)).toBe(`QuickAdd: ${CHOICE_NAME}`);
			// Importing a startup macro must not run it.
			await expect(sandbox.exists(RUN_LOG)).resolves.toBe(false);

			await obsidian.exec("command", { id: COMMAND_ID });
			await sandbox.waitForContent(RUN_LOG, (text) => text === "run\n", WAIT_OPTS);
			expect(await obsidian.dev.evalJson<boolean>(
				"window.__qaImportActivation === app.plugins.plugins.quickadd",
			)).toBe(true);

			await plugin.reload({ waitUntilReady: true });
			await sandbox.waitForContent(RUN_LOG, (text) => text === "run\nrun\n", WAIT_OPTS);
		} finally {
			await obsidian.dev.evalJson<boolean>("delete window.__qaImportActivation");
		}
	});
});
