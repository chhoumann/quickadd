import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { QuickAddSettings } from "../settings";
import { settingsStore } from "../settingsStore";
import { deepClone } from "../utils/deepClone";
import { SettingsPersistenceQueue } from "./settingsPersistenceQueue";

describe("SettingsPersistenceQueue integration with settingsStore lifecycle", () => {
	let originalState: QuickAddSettings;

	beforeEach(() => {
		originalState = deepClone(settingsStore.getState());
	});

	afterEach(() => {
		settingsStore.setState(deepClone(originalState));
	});

	it("persists latest revision from subscription updates on dispose", async () => {
		const writes: QuickAddSettings[] = [];
		const queue = new SettingsPersistenceQueue(async (settings) => {
			writes.push(deepClone(settings));
		});

		const unsubscribe = settingsStore.subscribe((settings) => {
			queue.schedule(settings);
		});

		const revision1 = deepClone(settingsStore.getState());
		revision1.version = "integration-r1";
		revision1.globalVariables = {
			...revision1.globalVariables,
			integration: "r1",
		};
		settingsStore.setState(revision1);

		const revision2 = deepClone(settingsStore.getState());
		revision2.version = "integration-r2";
		revision2.globalVariables = {
			...revision2.globalVariables,
			integration: "r2",
		};
		settingsStore.setState(revision2);

		unsubscribe();
		await queue.dispose();

		expect(writes.length).toBeGreaterThan(0);
		const lastWrite = writes[writes.length - 1];
		expect(lastWrite?.version).toBe("integration-r2");
		expect(lastWrite?.globalVariables.integration).toBe("r2");
	});

	it("flushes through transient save failures during unload-style flush", async () => {
		let attempts = 0;
		const writes: string[] = [];
		const queue = new SettingsPersistenceQueue(async (settings) => {
			attempts += 1;
			if (attempts < 3) {
				throw new Error(`transient-${attempts}`);
			}
			writes.push(settings.version);
		});

		const unsubscribe = settingsStore.subscribe((settings) => {
			queue.schedule(settings);
		});

		const revision = deepClone(settingsStore.getState());
		revision.version = "integration-final";
		settingsStore.setState(revision);

		unsubscribe();
		await queue.flushNow({ maxRetryAttempts: 4, timeoutMs: 2_000 });

		expect(attempts).toBe(3);
		expect(writes).toEqual(["integration-final"]);
	});
});
