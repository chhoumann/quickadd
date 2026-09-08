import { describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

const getContext = createQuickAddE2EHarness("property-capture");
const BODY = "\n# Project\n\nBody stays exactly here.\n";

async function saveChoice(choice: CaptureChoice) {
	const { plugin } = getContext();
	await plugin.data<{ choices: IChoice[] }>().patch((data) => { data.choices.push(choice); });
	await plugin.reload({ waitUntilReady: true });
}

function choiceFor(path: string) {
	const choice = new CaptureChoice("Property capture E2E");
	choice.captureTo = path;
	choice.onePageInput = "never";
	choice.format = { enabled: true, format: "{{VALUE:input}}" };
	choice.propertyCapture = { property: { kind: "named", format: "{{VALUE:property}}" }, action: "set", createIfMissing: true };
	return choice;
}

async function readNote(path: string) {
	const { obsidian } = getContext();
	const content = await obsidian.dev.evalJsonAsync<string>(`app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))`);
	const properties = await obsidian.metadata.frontmatter(path);
	return { properties: properties ?? {}, body: content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "") };
}

describe("property capture in native Obsidian", () => {
	it("sets text, zero, false and arrays through CLI vars without altering the body", async () => {
		const { obsidian, sandbox } = getContext();
		const path = await seedVaultFile(obsidian, sandbox, "types.md", `---\nstatus: active\nqa_capture_count: 7\nqa_capture_done: true\nqa_capture_sources: [old]\nkeep: unchanged\n---\n${BODY}`);
		const choice = choiceFor(path);
		choice.task = true;
		choice.insertAfter.enabled = true;
		choice.insertAfter.after = "{{VALUE:dormant}}";
		await saveChoice(choice);
		for (const [property, input] of Object.entries({ status: "001", qa_capture_count: 0, qa_capture_done: false, qa_capture_sources: ["a,b", "c"] })) {
			const outcome = await obsidian.execJson<{ ok: boolean }>("quickadd:run", { id: choice.id, verify: true, vars: JSON.stringify({ property, input }) });
			expect(outcome).toMatchObject({ ok: true, verified: true });
		}
		await expect.poll(() => readNote(path), { timeout: 10000, interval: 100 }).toEqual({ properties: { status: "001", qa_capture_count: 0, qa_capture_done: false, qa_capture_sources: ["a,b", "c"], keep: "unchanged" }, body: BODY });
	});

	it("adds a whole typed list through executeChoice and skips exact duplicates", async () => {
		const { obsidian, sandbox } = getContext();
		const path = await seedVaultFile(obsidian, sandbox, "list.md", `---\nqa_capture_sources: [old]\n---\n${BODY}`);
		const choice = choiceFor(path);
		choice.propertyCapture = { property: { kind: "named", format: "qa_capture_sources" }, action: "addToList", createIfMissing: true };
		await saveChoice(choice);
		await obsidian.dev.evalJsonAsync(`(async () => {
			await app.plugins.plugins.quickadd.api.executeChoice(${JSON.stringify(choice.name)}, { input: ["old", "a,b", "new", "new"] });
			return true;
		})()`);
		await expect.poll(() => readNote(path), { timeout: 10000, interval: 100 }).toEqual({ properties: { qa_capture_sources: ["old", "a,b", "new"] }, body: BODY });
		const outcome = await obsidian.execJson<{ ok: boolean; effect: string }>("quickadd:run", { id: choice.id, verify: true, vars: JSON.stringify({ input: ["old", "a,b", "new"] }) });
		expect(outcome).toMatchObject({ ok: true, effect: "unchanged" });
	});

	it("creates a new typed property and preserves a prepared template", async () => {
		const { obsidian, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "template.md", `---\nkeep: template\n---\n${BODY}`);
		const path = sandbox.path("created.md");
		const choice = choiceFor(path);
		choice.createFileIfItDoesntExist = { enabled: true, createWithTemplate: true, template };
		await saveChoice(choice);
		const outcome = await obsidian.execJson<{ ok: boolean; effect: string }>("quickadd:run", { id: choice.id, verify: true, vars: JSON.stringify({ property: "qa_capture_new_typed_number", input: 0 }) });
		expect(outcome).toMatchObject({ ok: true, effect: "created" });
		await expect.poll(() => readNote(path), { timeout: 10000, interval: 100 }).toEqual({ properties: { keep: "template", qa_capture_new_typed_number: 0 }, body: BODY });
	});

	it("rejects a runtime property picker headlessly without creating its target", async () => {
		const { obsidian, sandbox } = getContext();
		const path = sandbox.path("must-not-exist.md");
		const choice = choiceFor(path);
		choice.propertyCapture = { property: { kind: "prompt" }, action: "set", createIfMissing: true };
		choice.createFileIfItDoesntExist.enabled = true;
		await saveChoice(choice);
		const outcome = await obsidian.execJson<{ ok: boolean; error?: string }>("quickadd:run", { id: choice.id, verify: true, vars: JSON.stringify({ input: "done" }) });
		expect(outcome).toMatchObject({ ok: false, error: expect.stringContaining("property selection") });
		expect(await obsidian.dev.evalJson<boolean>(`Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))`)).toBe(false);
	});

	it("updates the existing property spelling when its configured name differs in case", async () => {
		const { obsidian, sandbox } = getContext();
		const path = await seedVaultFile(obsidian, sandbox, "casing.md", `---\nStatus: active\n---\n${BODY}`);
		const choice = choiceFor(path);
		choice.propertyCapture = { property: { kind: "named", format: "status" }, action: "set", createIfMissing: false };
		await saveChoice(choice);
		const outcome = await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, vars: JSON.stringify({ input: "done" }) });
		expect(outcome).toMatchObject({ ok: true, verified: true, effect: "changed" });
		await expect.poll(() => readNote(path), { timeout: 10000, interval: 100 })
			.toEqual({ properties: { Status: "done" }, body: BODY });
	});

	it.each([{ input: "" }, { input: [] }])("leaves a missing target absent for an empty Add value $input", async ({ input }) => {
		const { obsidian, sandbox } = getContext();
		const path = sandbox.path("empty-add/absent.md");
		const choice = choiceFor(path);
		choice.propertyCapture = { property: { kind: "named", format: "tags" }, action: "addToList", createIfMissing: true };
		choice.createFileIfItDoesntExist.enabled = true;
		await saveChoice(choice);
		const outcome = await obsidian.execJson("quickadd:run", { id: choice.id, verify: true, vars: JSON.stringify({ input }) });
		expect(outcome).toMatchObject({ ok: true, verified: true, effect: "unchanged" });
		expect(await obsidian.dev.evalJson<boolean>(`Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(sandbox.path("empty-add"))}))`)).toBe(false);
	});
});
