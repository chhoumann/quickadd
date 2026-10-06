import { afterEach, describe, expect, it, vi } from "vitest";
import { App, Notice } from "obsidian";
import { UserScript } from "../../types/macros/UserScript";
import { clearUserScriptSecretsFromCommand } from "../../utils/userScriptSecrets";
import { replaceScriptFile } from "./replaceScriptFile";

vi.mock("../../utils/userScriptSecrets", () => ({ clearUserScriptSecretsFromCommand: vi.fn() }));

const cleared = vi.mocked(clearUserScriptSecretsFromCommand);
afterEach(() => cleared.mockReset());

describe("replaceScriptFile", () => {
	it("takes the picked file and leaves the old script's settings behind", async () => {
		cleared.mockResolvedValueOnce(true);
		const command = new UserScript("old::helper", "scripts/old.js");
		command.settings = { token: { secretRef: "qa-secret" }, mode: "fast" };

		await replaceScriptFile(new App(), command, { name: "new", path: "scripts/new.js" });
		expect(command).toMatchObject({ name: "new", path: "scripts/new.js", settings: {} });
		expect(cleared).toHaveBeenCalledWith(expect.anything(), command);
	});

	it("keeps the step as it is when the same file is picked again", async () => {
		const command = new UserScript("old::helper", "scripts/old.js");
		command.settings = { token: { secretRef: "qa-secret" }, mode: "fast" };

		await replaceScriptFile(new App(), command, { name: "old", path: "scripts/old.js" });
		expect(command).toMatchObject({ name: "old::helper", path: "scripts/old.js", settings: { token: { secretRef: "qa-secret" }, mode: "fast" } });
		expect(cleared).not.toHaveBeenCalled();
	});

	it("still replaces the file when its secrets cannot all be cleared, and says so", async () => {
		cleared.mockResolvedValueOnce(false);
		const command = new UserScript("old", "scripts/old.js");
		command.settings = { token: { secretRef: "qa-secret" } };

		await replaceScriptFile(new App(), command, { name: "new", path: "scripts/new.js" });
		expect(command).toMatchObject({ name: "new", path: "scripts/new.js", settings: {} });
		const notices = (Notice as unknown as { instances: { message: string }[] }).instances;
		expect(notices.at(-1)?.message).toContain("secrets");
	});
});
