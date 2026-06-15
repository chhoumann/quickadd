import path from "node:path";
import {
	acquireVaultRunLock,
	createObsidianClient,
} from "obsidian-e2e";
import type {
	ObsidianClient,
	VaultRunLock,
} from "obsidian-e2e";

export const E2E_VAULT = process.env.QUICKADD_E2E_VAULT ?? "dev";
export const E2E_VAULT_EXPECTED_PATH = process.env.QUICKADD_E2E_VAULT_PATH;
export const E2E_OBSIDIAN_HOME = process.env.QUICKADD_E2E_OBSIDIAN_HOME;

export function createQuickAddObsidianClient(): ObsidianClient {
	return createObsidianClient({
		vault: E2E_VAULT,
		...(E2E_OBSIDIAN_HOME && {
			defaultExecOptions: {
				env: {
					...process.env,
					HOME: E2E_OBSIDIAN_HOME,
				},
			},
		}),
	});
}

export async function verifyE2EVault(obsidian: ObsidianClient): Promise<string> {
	await obsidian.verify();

	const vaultPath = path.resolve(await obsidian.vaultPath());
	if (E2E_VAULT_EXPECTED_PATH) {
		const expectedPath = path.resolve(E2E_VAULT_EXPECTED_PATH);
		if (vaultPath !== expectedPath) {
			throw new Error(
				[
					`Obsidian CLI resolved QUICKADD_E2E_VAULT=${E2E_VAULT} to ${vaultPath}.`,
					`Expected ${expectedPath}.`,
					"Refusing to run E2E tests against the wrong vault.",
				].join(" "),
			);
		}
	}

	return vaultPath;
}

export async function acquireQuickAddVaultRunLock(
	obsidian: ObsidianClient,
): Promise<VaultRunLock> {
	const vaultPath = await verifyE2EVault(obsidian);
	return acquireVaultRunLock({
		vaultName: E2E_VAULT,
		vaultPath,
	});
}
