import { afterAll, beforeAll, beforeEach } from "vitest";
import { captureFailureArtifacts, clearVaultRunLockMarker, createSandboxApi } from "obsidian-e2e";
import type { ObsidianClient, PluginHandle, SandboxApi, VaultRunLock } from "obsidian-e2e";
import { acquireQuickAddVaultRunLock, createQuickAddObsidianClient, PLUGIN_ID } from "./e2eVault";

type SuiteContext = { obsidian: ObsidianClient; qa: PluginHandle; sandbox: SandboxApi };

// These suites intentionally retain seeded plugin data between tests.
export function createSuiteLifecycle(name: string, ready: (context: SuiteContext) => void) {
	let obsidian: ObsidianClient | undefined;
	let qa: PluginHandle | undefined;
	let sandbox: SandboxApi | undefined;
	let lock: VaultRunLock | undefined;

	beforeAll(async () => {
		obsidian = createQuickAddObsidianClient();
		lock = await acquireQuickAddVaultRunLock(obsidian);
		await lock.publishMarker(obsidian);
		qa = obsidian.plugin(PLUGIN_ID);
		sandbox = await createSandboxApi({ obsidian, sandboxRoot: "__obsidian_e2e__", testName: name });
		ready({ obsidian, qa, sandbox });
	}, 30_000);

	afterAll(async () => {
		const errors: unknown[] = [];
		const steps: [string, () => unknown | Promise<unknown>][] = [
			["restoreData", () => qa?.restoreData?.()],
			["reload", () => qa?.reload?.()],
			["sandbox cleanup", () => sandbox?.cleanup?.()],
			["clear vault run lock marker", () => obsidian ? clearVaultRunLockMarker(obsidian) : undefined],
			["release vault lock", () => lock?.release()],
		];
		for (const [label, step] of steps) {
			try {
				await step();
			} catch (error) {
				errors.push(error);
				console.warn(`${name} teardown failed during ${label}`, error);
			}
		}
		if (errors.length > 0) throw errors[0];
	}, 15_000);

	beforeEach((ctx) => {
		ctx.onTestFailed(async () => {
			if (!obsidian) return;
			await captureFailureArtifacts(
				{ id: ctx.task.id, name: ctx.task.name }, obsidian,
				{ plugin: qa, captureOnFailure: true },
			);
		});
	});
}
