import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { CommandType } from "../../types/macros/CommandType";
import type { IUserScript } from "../../types/macros/IUserScript";
import { createUserScriptSecretRef } from "../../utils/userScriptSecrets";
import { UserScriptSettingsModal } from "./UserScriptSettingsModal";
import { pickUserScript } from "./pickUserScript";
import { migrateUserScriptSecretSettings } from "../../utils/userScriptSecrets";
import type * as UserScriptSecretsModule from "../../utils/userScriptSecrets";

vi.mock("./pickUserScript", () => ({ pickUserScript: vi.fn() }));
vi.mock("../../utils/userScriptSecrets", async (importOriginal) => {
	const actual = await importOriginal<typeof UserScriptSecretsModule>();
	return { ...actual, migrateUserScriptSecretSettings: vi.fn(actual.migrateUserScriptSecretSettings) };
});

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

function createSettings(optionOverrides: Record<string, unknown> = {}) {
	return {
		name: "Script Settings",
		options: {
			"API Key": {
				type: "secret" as const,
				defaultValue: "must-not-persist",
				placeholder: "Paste API key",
				description: "API key",
				...optionOverrides,
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

	it("uses script-defined secret option IDs when saving", async () => {
		const app = new App();
		const command = createCommand();
		const modal = new UserScriptSettingsModal(
			app,
			command,
			createSettings({ id: "readwise-api-key" }),
		);
		await flushPromises();

		const input = modal.contentEl.querySelector("input") as HTMLInputElement;
		inputValue(input, "secret-value");

		const save = modal.contentEl.querySelector(
			'button[aria-label="Save API Key"]',
		) as HTMLButtonElement;
		save.click();
		await flushPromises();

		expect(
			app.secretStorage.getSecret(
				"quickadd-user-script-command-1-readwise-api-key",
			),
		).toBe("secret-value");
		expect(command.settings["API Key"]).toEqual(
			createUserScriptSecretRef(
				"quickadd-user-script-command-1-readwise-api-key",
			),
		);
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

describe("UserScriptSettingsModal script file", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		vi.mocked(pickUserScript).mockReset();
	});

	function scriptFileSetting(modal: UserScriptSettingsModal) {
		const setting = modal.contentEl.firstElementChild;
		if (!setting) throw new Error("No setting rendered");
		return setting;
	}

	it("shows the script's file first, even for a script without options", () => {
		const modal = new UserScriptSettingsModal(new App(), createCommand(), {});

		expect(scriptFileSetting(modal).textContent).toContain("Script file");
		expect(scriptFileSetting(modal).textContent).toContain("scripts/script.js");
	});

	it("changes the file through the save callback and closes", async () => {
		vi.mocked(pickUserScript).mockResolvedValue({ name: "other", path: "scripts/other.js" });
		const command = createCommand();
		const onCommandChange = vi.fn(() => {
			expect(command).toMatchObject({ name: "other", path: "scripts/other.js" });
		});
		const modal = new UserScriptSettingsModal(new App(), command, createSettings(), onCommandChange);
		modal.open();
		await flushPromises();
		const close = vi.spyOn(modal, "close");

		const change = Array.from(scriptFileSetting(modal).querySelectorAll("button"))
			.find((button) => button.textContent === "Change");
		change?.click();
		await flushPromises();

		expect(onCommandChange).toHaveBeenCalledTimes(1);
		expect(command).toMatchObject({ name: "other", path: "scripts/other.js" });
		expect(close).toHaveBeenCalledTimes(1);
	});

	it("lets the secret migration finish before changing the file, so no old reference lands in the new settings", async () => {
		vi.mocked(pickUserScript).mockResolvedValue({ name: "other", path: "scripts/other.js" });
		let finishMigration!: () => void;
		vi.mocked(migrateUserScriptSecretSettings).mockImplementationOnce(
			(_app, command) =>
				new Promise<boolean>((resolve) => {
					finishMigration = () => {
						command.settings["API Key"] = createUserScriptSecretRef("quickadd-user-script-command-1-api-key");
						resolve(true);
					};
				}),
		);
		const command = createCommand({ "API Key": "legacy-secret" });
		const onCommandChange = vi.fn();
		const modal = new UserScriptSettingsModal(new App(), command, createSettings(), onCommandChange);
		modal.open();
		await flushPromises();

		const change = Array.from(scriptFileSetting(modal).querySelectorAll("button"))
			.find((button) => button.textContent === "Change");
		change?.click();
		await flushPromises();
		expect(command.path).toBe("scripts/script.js");

		finishMigration();
		await flushPromises();
		expect(command).toMatchObject({ path: "scripts/other.js", settings: {} });
	});

	it("leaves the step alone when no file is picked", async () => {
		vi.mocked(pickUserScript).mockResolvedValue(null);
		const command = createCommand();
		const onCommandChange = vi.fn();
		const modal = new UserScriptSettingsModal(new App(), command, {}, onCommandChange);
		const close = vi.spyOn(modal, "close");

		const change = Array.from(scriptFileSetting(modal).querySelectorAll("button"))
			.find((button) => button.textContent === "Change");
		change?.click();
		await flushPromises();

		expect(onCommandChange).not.toHaveBeenCalled();
		expect(command.path).toBe("scripts/script.js");
		expect(close).not.toHaveBeenCalled();
	});
});
