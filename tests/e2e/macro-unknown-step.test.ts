import { expect, it } from "vitest";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral, POLL_OPTS } from "./uiHelpers";

// A Macro step QuickAdd can't run (a type from a newer QuickAdd after a
// downgrade, or the retired Infinite AI Assistant) is skipped with a notice and
// the rest of the macro runs, from the CLI too.
const getContext = createQuickAddE2EHarness("macro-unknown-step");

it.each(["SomeFutureThing", "InfiniteAIAssistant"])(
	"checks and runs a macro past a %s step from the CLI",
	async (type) => {
		const { obsidian, plugin, sandbox } = getContext();
		const marker = sandbox.path(`ran-${type}.md`);
		const script = await seedVaultFile(obsidian, sandbox, `after-${type}.js`,
			`module.exports = async ({ app }) => { await app.vault.create(${jsLiteral(marker)}, "ran"); };`);
		await plugin.data<{ choices: unknown[] }>().patch((data) => {
			data.choices = [{
				id: "qa-e2e-unknown-step",
				name: "Unknown step macro",
				type: "Macro",
				command: false,
				macro: {
					id: "qa-e2e-unknown-step-macro",
					name: "Unknown step macro",
					commands: [
						{ id: "step-1", name: "Mystery", type },
						{ id: "step-2", name: "after", type: "UserScript", path: script, settings: {} },
					],
				},
			}];
		});
		await plugin.reload({ waitUntilReady: true });

		const check = await obsidian.execJson<{ ok: boolean }>("quickadd:check", { id: "qa-e2e-unknown-step" });
		expect(check).toMatchObject({ ok: true });

		const run = await obsidian.execJson<{ ok: boolean }>("quickadd:run", { id: "qa-e2e-unknown-step" });
		expect(run).toMatchObject({ ok: true });
		await expect.poll(() => sandbox.read(`ran-${type}.md`).catch(() => ""), POLL_OPTS).toBe("ran");
	},
);
