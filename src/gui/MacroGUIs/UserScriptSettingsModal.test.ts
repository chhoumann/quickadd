import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { CommandType } from "../../types/macros/CommandType";
import type { IUserScript } from "../../types/macros/IUserScript";
import { createUserScriptSecretRef } from "../../utils/userScriptSecrets";
import { UserScriptSettingsModal } from "./UserScriptSettingsModal";

vi.mock("../../quickAddInstance", () => ({
	getQuickAddInstance: vi.fn(() => ({})),
}));

vi.mock("../../formatters/formatDisplayFormatter", () => ({
	FormatDisplayFormatter: class {
		format(value: string): Promise<string> {
			return Promise.resolve(value);
		}
	},
}));

vi.mock("../suggesters/formatSyntaxSuggester", () => ({
	FormatSyntaxSuggester: class {},
}));

function createCommand(settings: Record<string, unknown> = {}): IUserScript {
	return {
		id: "command-1",
		name: "Script",
		type: CommandType.UserScript,
		path: "scripts/script.js",
		settings,
	};
}

function createSettings() {
	return {
		name: "Script Settings",
		options: {
			"API Key": {
				type: "secret" as const,
				defaultValue: "must-not-persist",
				placeholder: "Paste API key",
				description: "API key",
			},
		},
	};
}

function flushPromises(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function inputValue(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("UserScriptSettingsModal secret settings", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("does not write typed secret text into command settings until Save", async () => {
		const app = new App();
		const command = createCommand();
		const onCommandChange = vi.fn();
		const modal = new UserScriptSettingsModal(
			app,
			command,
			createSettings(),
			onCommandChange,
		);
		await flushPromises();

		const input = modal.contentEl.querySelector("input") as HTMLInputElement;
		inputValue(input, "secret-value");

		expect(command.settings["API Key"]).toBeUndefined();
		expect(JSON.stringify(command.settings)).not.toContain("secret-value");
		expect(onCommandChange).not.toHaveBeenCalled();

		const save = modal.contentEl.querySelector(
			'button[aria-label="Save API Key"]',
		) as HTMLButtonElement;
		save.click();
		await flushPromises();

		expect(app.secretStorage.getSecret("quickadd-user-script-command-1-api-key"))
			.toBe("secret-value");
		expect(command.settings["API Key"]).toEqual(
			createUserScriptSecretRef("quickadd-user-script-command-1-api-key"),
		);
		expect(JSON.stringify(command.settings)).not.toContain("secret-value");
		expect(onCommandChange).toHaveBeenCalledTimes(1);
		expect(input.value).toBe("");
	});

	it("migrates existing plaintext secret settings after opening", async () => {
		const app = new App();
		const command = createCommand({
			"API Key": "legacy-secret",
		});
		const onCommandChange = vi.fn();

		new UserScriptSettingsModal(app, command, createSettings(), onCommandChange);
		await flushPromises();

		expect(app.secretStorage.getSecret("quickadd-user-script-command-1-api-key"))
			.toBe("legacy-secret");
		expect(command.settings["API Key"]).toEqual(
			createUserScriptSecretRef("quickadd-user-script-command-1-api-key"),
		);
		expect(JSON.stringify(command.settings)).not.toContain("legacy-secret");
		expect(onCommandChange).toHaveBeenCalledTimes(1);
	});

	it("clears the marker and stored secret", async () => {
		const app = new App();
		app.secretStorage.setSecret(
			"quickadd-user-script-command-1-api-key",
			"secret-value",
		);
		const command = createCommand({
			"API Key": createUserScriptSecretRef(
				"quickadd-user-script-command-1-api-key",
			),
		});
		const onCommandChange = vi.fn();
		const modal = new UserScriptSettingsModal(
			app,
			command,
			createSettings(),
			onCommandChange,
		);
		await flushPromises();

		const clear = modal.contentEl.querySelector(
			'button[aria-label="Clear API Key"]',
		) as HTMLButtonElement;
		clear.click();
		await flushPromises();

		expect(app.secretStorage.getSecret("quickadd-user-script-command-1-api-key"))
			.toBeNull();
		expect(command.settings["API Key"]).toBeUndefined();
		expect(onCommandChange).toHaveBeenCalledTimes(1);
	});
});
