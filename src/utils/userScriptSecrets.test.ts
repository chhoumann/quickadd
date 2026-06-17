import type { App } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandType } from "../types/macros/CommandType";
import type { IUserScript } from "../types/macros/IUserScript";
import { initializeUserScriptSettings } from "./userScriptSettings";

const { logWarningMock } = vi.hoisted(() => ({
	logWarningMock: vi.fn(),
}));

vi.mock("../logger/logManager", () => ({
	log: {
		logWarning: logWarningMock,
	},
}));

const {
	buildUserScriptSecretId,
	clearUserScriptSecret,
	createUserScriptSecretRef,
	isSecretUserScriptOption,
	isUserScriptSecretRef,
	migrateUserScriptSecretSettings,
	resolveUserScriptSettings,
	storeUserScriptSecret,
} = await import("./userScriptSecrets");

function createCommand(settings: Record<string, unknown> = {}): IUserScript {
	return {
		id: "command-1",
		name: "Script",
		type: CommandType.UserScript,
		path: "scripts/script.js",
		settings,
	};
}

function createApp(secretStorage: {
	getSecret?: (name: string) => Promise<string | null> | string | null;
	setSecret?: (name: string, value: string) => Promise<void> | void;
	delete?: (name: string) => Promise<void> | void;
}): App {
	return { secretStorage } as unknown as App;
}

describe("userScriptSecrets", () => {
	beforeEach(() => {
		logWarningMock.mockReset();
	});

	it("detects explicit and legacy secret option declarations", () => {
		expect(isSecretUserScriptOption({ type: "secret" })).toBe(true);
		expect(
			isSecretUserScriptOption({ type: "text", secret: true }),
		).toBe(true);
		expect(
			isSecretUserScriptOption({ type: "input", secret: true }),
		).toBe(true);
		expect(
			isSecretUserScriptOption({ type: "textarea", secret: true }),
		).toBe(false);
		expect(isSecretUserScriptOption({ type: "text" })).toBe(false);
	});

	it("does not initialize secret default values into command settings", () => {
		const settings: Record<string, unknown> = {};

		initializeUserScriptSettings(settings, {
			options: {
				"API Key": {
					type: "secret",
					defaultValue: "must-not-persist",
				},
				Model: {
					type: "text",
					defaultValue: "gpt-4",
				},
			},
		});

		expect(settings).toEqual({ Model: "gpt-4" });
	});

	it("builds valid deterministic SecretStorage IDs", () => {
		expect(buildUserScriptSecretId(createCommand(), "API Key")).toBe(
			"quickadd-user-script-command-1-api-key",
		);
	});

	it("stores a secret and creates a marker without exposing the value", async () => {
		const setSecret = vi.fn().mockResolvedValue(undefined);
		const getSecret = vi.fn().mockResolvedValue(null);
		const app = createApp({ getSecret, setSecret });
		const command = createCommand();

		const secretRef = await storeUserScriptSecret(
			app,
			command,
			"API Key",
			"super-secret",
		);

		expect(secretRef).toBe("quickadd-user-script-command-1-api-key");
		expect(setSecret).toHaveBeenCalledWith(
			"quickadd-user-script-command-1-api-key",
			"super-secret",
		);
		const marker = createUserScriptSecretRef(secretRef!);
		expect(isUserScriptSecretRef(marker)).toBe(true);
		expect(JSON.stringify(marker)).not.toContain("super-secret");
	});

	it("resolves markers into an ephemeral settings object", async () => {
		const command = createCommand({
			"API Key": createUserScriptSecretRef(
				"quickadd-user-script-command-1-api-key",
			),
			Model: "gpt-4",
		});
		const app = createApp({
			getSecret: vi.fn().mockResolvedValue("secret-value"),
		});

		const resolved = await resolveUserScriptSettings(app, command, {
			options: {
				"API Key": { type: "secret" },
				Model: { type: "text" },
			},
		});

		expect(resolved).toEqual({
			"API Key": "secret-value",
			Model: "gpt-4",
		});
		expect(command.settings["API Key"]).toEqual(
			createUserScriptSecretRef("quickadd-user-script-command-1-api-key"),
		);
	});

	it("preserves legacy plaintext secret settings when migration has not run", async () => {
		const command = createCommand({
			"API Key": "legacy-secret",
		});

		const resolved = await resolveUserScriptSettings(undefined, command, {
			options: {
				"API Key": { type: "text", secret: true },
			},
		});

		expect(resolved["API Key"]).toBe("legacy-secret");
		expect(command.settings["API Key"]).toBe("legacy-secret");
	});

	it("throws a clear error when a marker cannot resolve on this device", async () => {
		const command = createCommand({
			"API Key": createUserScriptSecretRef(
				"quickadd-user-script-command-1-api-key",
			),
		});

		await expect(
			resolveUserScriptSettings(undefined, command, {
				options: { "API Key": { type: "secret" } },
			}),
		).rejects.toThrow(/Re-enter it on this device/);
	});

	it("clears through SecretStorage delete when available", async () => {
		const deleteSecret = vi.fn().mockResolvedValue(undefined);
		const app = createApp({ delete: deleteSecret });

		await expect(clearUserScriptSecret(app, "secret-ref")).resolves.toBe(true);
		expect(deleteSecret).toHaveBeenCalledWith("secret-ref");
	});

	it("falls back to overwriting with an empty value when delete is unavailable", async () => {
		const setSecret = vi.fn().mockResolvedValue(undefined);
		const app = createApp({ setSecret });

		await expect(clearUserScriptSecret(app, "secret-ref")).resolves.toBe(true);
		expect(setSecret).toHaveBeenCalledWith("secret-ref", "");
	});

	it("migrates legacy plaintext secret settings into SecretStorage", async () => {
		const command = createCommand({
			"API Key": "legacy-secret",
			Model: "gpt-4",
		});
		const setSecret = vi.fn().mockResolvedValue(undefined);
		const app = createApp({
			getSecret: vi.fn().mockResolvedValue(null),
			setSecret,
		});

		const changed = await migrateUserScriptSecretSettings(app, command, {
			options: {
				"API Key": { type: "secret" },
				Model: { type: "text" },
			},
		});

		expect(changed).toBe(true);
		expect(setSecret).toHaveBeenCalledWith(
			"quickadd-user-script-command-1-api-key",
			"legacy-secret",
		);
		expect(command.settings["API Key"]).toEqual(
			createUserScriptSecretRef("quickadd-user-script-command-1-api-key"),
		);
		expect(JSON.stringify(command.settings)).not.toContain("legacy-secret");
	});

	it("does not migrate or clear legacy plaintext when SecretStorage is unavailable", async () => {
		const command = createCommand({
			"API Key": "legacy-secret",
		});

		const changed = await migrateUserScriptSecretSettings(undefined, command, {
			options: {
				"API Key": { type: "secret" },
			},
		});

		expect(changed).toBe(false);
		expect(command.settings["API Key"]).toBe("legacy-secret");
		expect(logWarningMock).toHaveBeenCalledWith(
			expect.stringContaining("SecretStorage unavailable"),
		);
	});

	it("leaves plaintext untouched when SecretStorage write fails", async () => {
		const command = createCommand({
			"API Key": "legacy-secret",
		});
		const app = createApp({
			getSecret: vi.fn().mockResolvedValue(null),
			setSecret: vi.fn().mockRejectedValue(new Error("write failed")),
		});

		const changed = await migrateUserScriptSecretSettings(app, command, {
			options: {
				"API Key": { type: "secret" },
			},
		});

		expect(changed).toBe(false);
		expect(command.settings["API Key"]).toBe("legacy-secret");
		expect(logWarningMock).toHaveBeenCalledWith(
			expect.stringContaining("Failed to write user script SecretStorage entry"),
		);
	});

	it("is a no-op for already migrated secret settings", async () => {
		const command = createCommand({
			"API Key": createUserScriptSecretRef(
				"quickadd-user-script-command-1-api-key",
			),
		});
		const setSecret = vi.fn();
		const app = createApp({
			getSecret: vi.fn().mockResolvedValue("existing-secret"),
			setSecret,
		});

		const changed = await migrateUserScriptSecretSettings(app, command, {
			options: {
				"API Key": { type: "secret" },
			},
		});

		expect(changed).toBe(false);
		expect(setSecret).not.toHaveBeenCalled();
	});
});
