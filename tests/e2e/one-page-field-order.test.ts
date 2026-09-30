import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, expectNoPrompt, jsLiteral, pressKey, waitForElement } from "./uiHelpers";

// #1876: the one-page form lists fields in the order the format reads, not
// dates first and the capture text last.
const getContext = createQuickAddE2EHarness("one-page-field-order");

type QuickAddData = {
	choices: IChoice[];
	onePageInputEnabled: boolean;
};

const FIELD = ".modal-container .setting-item";

async function closeOpenPrompts() {
	const { obsidian } = getContext();
	for (let remaining = 10; remaining > 0; remaining--) {
		if (!await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container, .prompt"))')) break;
		await pressKey(obsidian, "Escape");
	}
	await expectNoPrompt(obsidian);
}

beforeEach(closeOpenPrompts);
afterEach(closeOpenPrompts);

describe("one-page form field order", () => {
	it("follows the Capture format, and the run writes the same note", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const choice = new CaptureChoice("Log order");
		choice.command = true;
		choice.onePageInput = "always";
		choice.captureTo = sandbox.path("orders.md");
		choice.createFileIfItDoesntExist = { ...choice.createFileIfItDoesntExist, enabled: true };
		choice.format = {
			enabled: true,
			format: "### {{VALUE}} for {{VALUE:client}}\n- [ ] Deliver 📅 {{VDATE:due,YYYY-MM-DD}}\n- [ ] Invoice 📅 {{VALUE:due}}\n",
		};
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = false;
			data.choices.push(choice);
		});
		await plugin.reload({ waitUntilReady: true });
		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		await waitForElement(obsidian, FIELD);
		expect(await obsidian.dev.evalJson<string[]>(
			`Array.from(document.querySelectorAll(${JSON.stringify(FIELD)})).map((field) => field.querySelector(".setting-item-name")?.textContent ?? "")`,
		)).toEqual(["Enter value", "client", "due"]);

		for (const [index, text] of ["48 mugs", "Northwind", "2026-10-02"].entries()) {
			expect(await obsidian.dev.evalJson<boolean>(`(() => {
				const input = document.querySelectorAll(${JSON.stringify(FIELD)})[${index}]?.querySelector("input, textarea");
				input?.focus();
				return Boolean(input);
			})()`)).toBe(true);
			await obsidian.exec("dev:cdp", {
				method: "Input.insertText",
				params: JSON.stringify({ text }),
			});
		}
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll(".modal-container button")].find((button) => button.textContent === "Submit")?.click();
			return true;
		})()`);
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("orders.md").catch(() => ""), POLL_OPTS)
			.toBe("### 48 mugs for Northwind\n- [ ] Deliver 📅 2026-10-02\n- [ ] Invoice 📅 2026-10-02\n");
	});
});

describe("one-page form capture target", () => {
	it("lists the folder's note picker first, as the run asks for it first (#1947)", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		await seedVaultFile(obsidian, sandbox, "inbox/alpha.md", "# Alpha\n");
		await seedVaultFile(obsidian, sandbox, "inbox/beta.md", "# Beta\n");
		const choice = new CaptureChoice("Log to inbox note");
		choice.command = true;
		choice.onePageInput = "always";
		choice.captureTo = `${sandbox.path("inbox")}/`;
		choice.format = { enabled: true, format: "- {{VALUE:what}} 📅 {{VDATE:due,YYYY-MM-DD}}\n" };
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = false;
			data.choices.push(choice);
		});
		await plugin.reload({ waitUntilReady: true });
		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		await waitForElement(obsidian, FIELD);
		expect(await obsidian.dev.evalJson<string[]>(
			`Array.from(document.querySelectorAll(${JSON.stringify(FIELD)})).map((field) => field.querySelector(".setting-item-name")?.textContent ?? "")`,
		)).toEqual(["Select capture target file", "what", "due"]);

		expect(await obsidian.dev.evalJson<boolean>(`(() => {
			const select = document.querySelectorAll(${JSON.stringify(FIELD)})[0]?.querySelector("select");
			if (!select) return false;
			select.value = ${JSON.stringify(sandbox.path("inbox/beta.md"))};
			select.dispatchEvent(new Event("change"));
			return select.value === ${JSON.stringify(sandbox.path("inbox/beta.md"))};
		})()`)).toBe(true);
		for (const [index, text] of [[1, "Call Ada"], [2, "2026-10-02"]] as const) {
			expect(await obsidian.dev.evalJson<boolean>(`(() => {
				const input = document.querySelectorAll(${JSON.stringify(FIELD)})[${index}]?.querySelector("input, textarea");
				input?.focus();
				return Boolean(input);
			})()`)).toBe(true);
			await obsidian.exec("dev:cdp", {
				method: "Input.insertText",
				params: JSON.stringify({ text }),
			});
		}
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll(".modal-container button")].find((button) => button.textContent === "Submit")?.click();
			return true;
		})()`);
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("inbox/beta.md"), POLL_OPTS)
			.toBe("- Call Ada 📅 2026-10-02\n# Beta\n");
		expect(await sandbox.read("inbox/alpha.md")).toBe("# Alpha\n");
	});
});

describe("one-page form for a Template choice", () => {
	it("lists the folder before the file name and the note content, as the run asks (#1997)", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "client-template.md", "{{VALUE:summary|label:Summary}}\n");
		const choice = new TemplateChoice("Client note");
		choice.command = true;
		choice.onePageInput = "always";
		choice.templatePath = template;
		choice.fileNameFormat = { enabled: true, format: "{{VALUE:title|label:Note title}}" };
		choice.folder = { ...choice.folder, enabled: true, folders: [`${sandbox.path("clients")}/{{VALUE:client|label:Client}}`] };
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = false;
			data.choices.push(choice);
		});
		await plugin.reload({ waitUntilReady: true });
		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });

		await waitForElement(obsidian, FIELD);
		const labels = await obsidian.dev.evalJson<string[]>(
			`Array.from(document.querySelectorAll(${jsLiteral(FIELD)})).filter((field) => field.querySelector("input, textarea")).map((field) => field.querySelector(".setting-item-name")?.textContent ?? "")`,
		);
		expect(labels).toEqual(["Client", "Note title", "Summary"]);

		for (const [label, text] of [["Client", "Acme"], ["Note title", "Kickoff"], ["Summary", "Went well"]] as const) {
			expect(await obsidian.dev.evalJson<boolean>(`(() => {
				const field = Array.from(document.querySelectorAll(${jsLiteral(FIELD)})).find((row) => row.querySelector(".setting-item-name")?.textContent === ${jsLiteral(label)});
				const input = field?.querySelector("input, textarea");
				input?.focus();
				return Boolean(input);
			})()`)).toBe(true);
			await obsidian.exec("dev:cdp", {
				method: "Input.insertText",
				params: JSON.stringify({ text }),
			});
		}
		await obsidian.dev.evalJson(`(() => {
			[...document.querySelectorAll(".modal-container button")].find((button) => button.textContent === "Submit")?.click();
			return true;
		})()`);
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("clients/Acme/Kickoff.md").catch(() => ""), POLL_OPTS)
			.toBe("Went well\n");
	});
});
