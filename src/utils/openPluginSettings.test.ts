import { describe, it, expect, vi, beforeEach } from "vitest";
import { tryOpenPluginSettings } from "./openPluginSettings";
import { log } from "../logger/logManager";
import type { App } from "obsidian";

vi.mock("../logger/logManager", () => ({
	log: {
		logError: vi.fn(),
	},
}));

describe("tryOpenPluginSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should successfully open tab and return true", () => {
		const fakeApp = {
			setting: {
				open: vi.fn(),
				openTabById: vi.fn(),
			},
		} as unknown as App;

		const result = tryOpenPluginSettings(fakeApp, "my-plugin");

		expect(result).toBe(true);
		expect((fakeApp as any).setting.open).toHaveBeenCalledOnce();
		expect((fakeApp as any).setting.openTabById).toHaveBeenCalledWith("my-plugin");
		expect(log.logError).not.toHaveBeenCalled();
	});

	it("should return false and log error if internal API is missing", () => {
		const fakeApp = {} as unknown as App;

		const result = tryOpenPluginSettings(fakeApp, "my-plugin");

		expect(result).toBe(false);
		expect(log.logError).toHaveBeenCalledWith(
			"QuickAdd: Obsidian internal settings API is unavailable."
		);
	});

	it("should return false and log error if an exception is thrown", () => {
		const fakeApp = {
			setting: {
				open: () => {
					throw new Error("Simulated error");
				},
				openTabById: vi.fn(),
			},
		} as unknown as App;

		const result = tryOpenPluginSettings(fakeApp, "my-plugin");

		expect(result).toBe(false);
		expect(log.logError).toHaveBeenCalledWith(
			"QuickAdd: Failed to open plugin settings automatically: Error: Simulated error"
		);
	});
});
