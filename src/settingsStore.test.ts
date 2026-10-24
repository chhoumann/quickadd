import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import { settingsStore } from "./settingsStore";
import { deepClone } from "./utils/deepClone";

describe("settingsStore", () => {
	beforeEach(() => {
		settingsStore.replaceState(deepClone(DEFAULT_SETTINGS));
	});

	it("merges partial updates and keeps untouched settings", () => {
		const before = settingsStore.getState();
		settingsStore.setState({ showCaptureNotification: !before.showCaptureNotification });
		settingsStore.setState((state) => ({ templateFolderPaths: [...state.templateFolderPaths, "T"] }));

		const after = settingsStore.getState();
		expect(after).not.toBe(before);
		expect(after.showCaptureNotification).toBe(!before.showCaptureNotification);
		expect(after.templateFolderPaths).toEqual([...before.templateFolderPaths, "T"]);
		expect(after.choices).toBe(before.choices);
	});

	it("replaces the whole state", () => {
		const next = { ...deepClone(DEFAULT_SETTINGS), choices: [] };
		settingsStore.replaceState(next);
		expect(settingsStore.getState()).toBe(next);
	});

	it("notifies subscribers with the new and previous state until they unsubscribe", () => {
		const listener = vi.fn();
		const unsubscribe = settingsStore.subscribe(listener);
		const before = settingsStore.getState();

		settingsStore.setState({ disableOnlineFeatures: !before.disableOnlineFeatures });
		expect(listener).toHaveBeenCalledExactlyOnceWith(settingsStore.getState(), before);

		unsubscribe();
		settingsStore.setState({ disableOnlineFeatures: before.disableOnlineFeatures });
		expect(listener).toHaveBeenCalledOnce();
	});

	it("does not notify when the state object is unchanged", () => {
		const listener = vi.fn();
		const unsubscribe = settingsStore.subscribe(listener);
		settingsStore.replaceState(settingsStore.getState());
		settingsStore.setState((state) => state);
		unsubscribe();
		expect(listener).not.toHaveBeenCalled();
	});
});
