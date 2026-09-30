import type * as UtilityObsidian from "../utilityObsidian";
import type { TFile } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { templateHarness } from "../../tests/helpers/engines/templateHarness";
import { TemplateInsertEngine } from "./TemplateInsertEngine";
import { overwriteTemplaterOnce, templaterParseTemplate } from "../utilityObsidian";

vi.mock("../main", () => ({ default: class {} }));
vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("../utilityObsidian", async importOriginal => ({
	...await importOriginal<typeof UtilityObsidian>(),
	overwriteTemplaterOnce: vi.fn(),
	templaterParseTemplate: vi.fn(),
}));

// Stands in for Templater: a tag that upper-cases a string literal renders it,
// any other tag renders as TP-RAN.
const render = (content: string) => content
	.replace(/<%\s*"([^"]*)"\.toUpperCase\(\)\s*%>/g, (_tag, text: string) => text.toUpperCase())
	.replace(/<%[\s\S]*?%>/g, "TP-RAN");

const ANSWER = "a {{TITLE}} {{RANDOM:3}} {{CURSOR}} <% tp.date.now() %> b";

let h: ReturnType<typeof templateHarness>;

beforeEach(() => {
	h = templateHarness();
	h.executor.variables.set("answer", ANSWER);
	vi.mocked(templaterParseTemplate).mockReset().mockImplementation(async (_app, content) => render(content));
	vi.mocked(overwriteTemplaterOnce).mockReset().mockImplementation(async (_app, file: TFile) => {
		h.contents.set(file.path, render(h.contents.get(file.path) ?? ""));
		return false;
	});
});

describe("Template choices keep tokens and Templater tags inside answers literal", () => {
	it("creates a note with the answer as it is and the cursor on the template's marker", async () => {
		h.file("template.md", "<% 'own' %> {{VALUE:answer}} {{CURSOR}}end");

		await h.engine.create("note.md", "template.md");

		const expected = `TP-RAN ${ANSWER} end`;
		expect(h.contents.get("note.md")).toBe(expected);
		expect(h.engine.getCursorPlacement()).toEqual({ content: expected, offsets: [expected.length - 3] });
	});

	it("appends the answer as it is", async () => {
		const note = h.file("note.md", "existing");
		h.file("template.md", "<% 'own' %> {{VALUE:answer}}");

		await h.engine.append(note, "template.md", "bottom");

		expect(h.contents.get("note.md")).toBe(`existing\nTP-RAN ${ANSWER}`);
	});

	it("inserts the answer as it is when applying a template to a note", async () => {
		const note = h.file("note.md", "existing\n");
		h.file("template.md", "<% 'own' %> {{VALUE:answer}}\n");

		await new TemplateInsertEngine(h.app, h.plugin, note, "template.md", "bottom", h.executor).apply();

		expect(h.contents.get("note.md")).toBe(`existing\n\nTP-RAN ${ANSWER}\n`);
	});

	it("keeps an answer given inside an included template as it is", async () => {
		h.file("inc.md", "[{{VALUE:answer}}]");
		h.file("template.md", "{{TEMPLATE:inc.md}} {{TITLE}}");

		await h.engine.create("note.md", "template.md");

		expect(h.contents.get("note.md")).toBe(`[${ANSWER}] note`);
	});

	it("still gives the answer to a Templater tag in the template", async () => {
		h.executor.variables.set("answer", "x <% y %> {{TITLE}} 50%>40%");
		h.file("template.md", '<% "{{VALUE:answer}}".toUpperCase() %>');

		await h.engine.create("note.md", "template.md");

		expect(h.contents.get("note.md")).toBe("X <% Y %> {{TITLE}} 50%>40%");
	});
});
