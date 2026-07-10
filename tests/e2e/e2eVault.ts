import {
	acquireVaultRunLock,
	createObsidianClient,
	resolveObsidianEnvOptions,
	verifyVaultPath,
} from "obsidian-e2e";
import type { ObsidianClient, VaultRunLock } from "obsidian-e2e";
import { createPluginHarness } from "obsidian-e2e/vitest";

export const PLUGIN_ID = "quickadd";

// Canonical OBSIDIAN_E2E_* env is emitted by the shared obsidian-e2e runner; the
// legacy QUICKADD_E2E_* aliases remain a fallback during the migration. The
// resolver injects the Obsidian HOME into a per-client `defaultExecOptions.env`
// (never mutating `process.env`) and surfaces the expected vault path.
const resolvedEnv = resolveObsidianEnvOptions({ legacyPrefix: "QUICKADD" });
const { expectedVaultPath, ...clientOptions } = resolvedEnv;

export const E2E_VAULT = clientOptions.vault;
export const E2E_VAULT_EXPECTED_PATH = expectedVaultPath;

export function createQuickAddObsidianClient(): ObsidianClient {
	return createObsidianClient(clientOptions);
}

export async function verifyE2EVault(obsidian: ObsidianClient): Promise<string> {
	await obsidian.verify();
	return verifyVaultPath({
		actualVaultPath: await obsidian.vaultPath(),
		expectedVaultPath: E2E_VAULT_EXPECTED_PATH,
		vaultName: E2E_VAULT,
	});
}

export async function acquireQuickAddVaultRunLock(
	obsidian: ObsidianClient,
): Promise<VaultRunLock> {
	const vaultPath = await verifyE2EVault(obsidian);
	return acquireVaultRunLock({ vaultName: E2E_VAULT, vaultPath });
}

/**
 * Suite-scoped QuickAdd E2E harness on obsidian-e2e's shared
 * `createPluginHarness`: one vault lock + sandbox + reload per file, per-test
 * diagnostics reset and data restore, and failure-artifact capture. Returns the
 * `(testName) => () => context` getter that yields `{ obsidian, plugin, sandbox }`.
 *
 * Only files without cross-test seeded plugin data adopt this - QuickAdd suites
 * that seed choices in a `describe` `beforeAll` and assert them across several
 * tests keep their bespoke per-file lifecycle, since the harness rolls data.json
 * back after every test.
 */
export const createQuickAddE2EHarness = createPluginHarness({
	...resolvedEnv,
	pluginId: PLUGIN_ID,
	// QuickAdd exposes its public API on the plugin instance once loaded
	// (`app.plugins.plugins.quickadd.api`), the most precise ready signal - the
	// same seam other plugins integrate against.
	waitUntilReady: (obsidian) =>
		obsidian.dev.evalJson<boolean>(
			`Boolean(app.plugins.plugins.${PLUGIN_ID}?.api)`,
		),
	// QuickAdd ships a hand-written styles.css alongside the compiled main.js, so
	// the provisioned dev vault symlinks all three plugin artifacts.
	symlinkArtifacts: ["main.js", "manifest.json", "styles.css"],
	captureOnFailure: true,
});
