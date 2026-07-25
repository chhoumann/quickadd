import { describe, it, expect, vi, beforeEach } from "vitest";
import { openQuickAddSettings, tryOpenPluginSettings } from "./openPluginSettings";
import { log } from "../logger/logManager";
import type { App } from "obsidian";
import { Notice } from "obsidian";

vi.mock("../logger/logManager", () => ({
	log: {
		logMessage: vi.fn(),
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
		expect(log.logMessage).not.toHaveBeenCalled();
	});

	it("should return false and log (without a notice) if the internal API is missing", () => {
		const fakeApp = {} as unknown as App;

		const result = tryOpenPluginSettings(fakeApp, "my-plugin");

		expect(result).toBe(false);
		expect(log.logMessage).toHaveBeenCalledWith(
			"QuickAdd: Obsidian internal settings API is unavailable."
		);
	});

	it("should return false and log if an exception is thrown from setting.open", () => {
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
		expect(log.logMessage).toHaveBeenCalledWith(
			"QuickAdd: Failed to open plugin settings automatically: Error: Simulated error"
		);
	});

	it("should return false and log if opening the tab throws", () => {
		const fakeApp = {
			setting: {
				open: vi.fn(),
				openTabById: () => {
					throw new Error("Simulated tab error");
				},
			},
		} as unknown as App;

		expect(tryOpenPluginSettings(fakeApp, "my-plugin")).toBe(false);
		expect(log.logMessage).toHaveBeenCalledWith(
			"QuickAdd: Failed to open plugin settings automatically: Error: Simulated tab error"
		);
	});
});

describe("openQuickAddSettings", () => {
	const workingApp = () =>
		({ setting: { open: vi.fn(), openTabById: vi.fn() } }) as unknown as App;

	beforeEach(() => {
		vi.clearAllMocks();
		(Notice as unknown as { instances: unknown[] }).instances = [];
	});

	it("opens the tab and stays silent on success", () => {
		const app = workingApp();

		expect(openQuickAddSettings(app, "quickadd")).toBe(true);
		expect(
			(app as unknown as { setting: { openTabById: ReturnType<typeof vi.fn> } })
				.setting.openTabById,
		).toHaveBeenCalledWith("quickadd");
		expect((Notice as unknown as { instances: unknown[] }).instances).toHaveLength(0);
	});

	it("tells the user where to go when the internal API is unavailable", () => {
		expect(openQuickAddSettings({} as App, "quickadd")).toBe(false);

		const notices = (Notice as unknown as { instances: Array<{ message: string }> })
			.instances;
		expect(notices).toHaveLength(1);
		expect(notices[0].message).toBe(
			"QuickAdd: Unable to open settings automatically. Open Settings → QuickAdd manually.",
		);
	});

	// Callers that already explained themselves (openChoiceLauncher,
	// runTemplateFromFolder) must not stack a second, generic notice on top of
	// their specific one. This is why the failure path logs through logMessage:
	// GuiLogger turns every logError into a 15-second Notice, which would defeat
	// the suppression entirely.
	it("suppresses every notice when asked to, but still logs", () => {
		expect(openQuickAddSettings({} as App, "quickadd", { notice: false })).toBe(
			false,
		);
		expect((Notice as unknown as { instances: unknown[] }).instances).toHaveLength(0);
		expect(log.logMessage).toHaveBeenCalledWith(
			"QuickAdd: Obsidian internal settings API is unavailable.",
		);
	});
});
