import { describe, expect, it, vi } from "vitest";
import { App } from "obsidian";
import { UserScript } from "../../types/macros/UserScript";
import { clearUserScriptSecretsFromCommand } from "../../utils/userScriptSecrets";
import { replaceScriptFile } from "./replaceScriptFile";

vi.mock("../../utils/userScriptSecrets", () => ({ clearUserScriptSecretsFromCommand: vi.fn() }));

const cleared = vi.mocked(clearUserScriptSecretsFromCommand);

describe("replaceScriptFile", () => {
	it("takes the picked file and leaves the old script's settings behind", async () => {
		cleared.mockResolvedValueOnce(true);
		const command = new UserScript("old::helper", "scripts/old.js");
		command.settings = { token: { secretRef: "qa-secret" }, mode: "fast" };

		expect(await replaceScriptFile(new App(), command, { name: "new", path: "scripts/new.js" })).toBe(true);
		expect(command).toMatchObject({ name: "new", path: "scripts/new.js", settings: {} });
		expect(cleared).toHaveBeenCalledWith(expect.anything(), command);
	});

	it("leaves the step as it was when its secrets cannot be cleared", async () => {
		cleared.mockResolvedValueOnce(false);
		const command = new UserScript("old", "scripts/old.js");
		command.settings = { token: { secretRef: "qa-secret" } };

		expect(await replaceScriptFile(new App(), command, { name: "new", path: "scripts/new.js" })).toBe(false);
		expect(command).toMatchObject({ name: "old", path: "scripts/old.js", settings: { token: { secretRef: "qa-secret" } } });
	});
});
