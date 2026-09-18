import { createMockApp } from "../../tests/helpers/formatters/captureFixtures";
import { createCaptureFormatterPlugin } from "../../tests/helpers/formatters/plugin";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

vi.mock("../utilityObsidian", async () => (await import("../../tests/helpers/formatters/mocks")).utilityObsidianMock());

vi.mock("obsidian-dataview", async () => (await import("../../tests/helpers/formatters/mocks")).obsidiandataviewMock());

import { CaptureChoiceFormatter } from "./captureChoiceFormatter";
import { CaptureChoice } from "../types/choices/CaptureChoice";

const createChoice = (overrides: Partial<ICaptureChoice> = {}): ICaptureChoice => ({
	id: "test",
	name: "Test Choice",
	type: "Capture",
	command: false,
	captureTo: "Target.md",
	captureToActiveFile: false,
	captureToCanvasNodeId: "",
	activeFileWritePosition: "cursor",
	createFileIfItDoesntExist: {
		enabled: false,
		createWithTemplate: false,
		template: "",
	},
	format: { enabled: false, format: "" },
	prepend: false,
	appendLink: false,
	task: false,
	insertAfter: {
		enabled: false,
		after: "",
		insertAtEnd: false,
		considerSubsections: false,
		createIfNotFound: false,
		createIfNotFoundLocation: "",
		inline: false,
		replaceExisting: false,
		blankLineAfterMatchMode: "auto",
	},
	newLineCapture: { enabled: false, direction: "below" },
	openFile: false,
	fileOpening: {
		location: "tab",
		direction: "vertical",
		mode: "default",
		focus: true,
	},
	...overrides,
});

const createFile = (path = "Test.md"): TFile => {
	const name = path.split("/").pop() ?? path;
	return {
		path,
		name,
		basename: name.replace(/\.(md|canvas)$/i, ""),
		extension: "md",
	} as unknown as TFile;
};

describe("CaptureChoiceFormatter write position behavior", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		(global as any).navigator = {
			clipboard: {
				readText: vi.fn().mockResolvedValue(""),
			},
		};
	});

	it("writes to top for non-active targets when prepend is false", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({ captureToActiveFile: false, prepend: false }),
			"Line A\nLine B",
			createFile(),
		);

		expect(result).toBe("CAPTURE\nLine A\nLine B");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe("CAPTURE\n".length);
	});

	it("tracks cursor after top insertion below frontmatter", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE",
			createChoice({ captureToActiveFile: false, prepend: false }),
			"---\ntitle: Test\n---\nBody",
			createFile(),
		);

		expect(result).toBe("---\ntitle: Test\n---\nCAPTURE\nBody");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			result.indexOf("CAPTURE") + "CAPTURE".length,
		);
	});

	it("tracks cursor past the frontmatter separator line (issue #1538)", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"Call the dentist",
			createChoice({ captureToActiveFile: false, prepend: false }),
			"---\ndate: 2026-07-25\n---\n\n## Log\n\n## Tasks\n",
			createFile(),
		);

		expect(result).toBe(
			"---\ndate: 2026-07-25\n---\n\nCall the dentist\n## Log\n\n## Tasks\n",
		);
		// The cursor lands at the end of the capture, not one line too early.
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			"---\ndate: 2026-07-25\n---\n\nCall the dentist".length,
		);
	});

	it("writes to bottom for non-active targets when prepend is true", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE",
			createChoice({ captureToActiveFile: false, prepend: true }),
			"Line A\nLine B",
			createFile(),
		);

		expect(result).toBe("Line A\nLine B\nCAPTURE");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(result.length);
	});

	it("writes to bottom for active-file targets when mode is bottom", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result } = await formatter.formatContentWithFile(
			"CAPTURE",
			createChoice({
				captureToActiveFile: true,
				activeFileWritePosition: "bottom",
				prepend: false,
			}),
			"Line A\nLine B",
			createFile("Active.md"),
		);

		expect(result).toBe("Line A\nLine B\nCAPTURE");
	});

	it("inserts before a matched target line", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertBefore: {
					enabled: true,
					before: "## Later",
					createIfNotFound: false,
					createIfNotFoundLocation: "",
				},
			}),
			"# Inbox\nBody\n## Later\nNext",
			createFile(),
		);

		expect(result).toBe("# Inbox\nBody\nCAPTURE\n## Later\nNext");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			result.indexOf("CAPTURE\n") + "CAPTURE\n".length,
		);
	});

	it("separates capture content from the matched line when inserting before", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE",
			createChoice({
				insertBefore: {
					enabled: true,
					before: "Line B",
					createIfNotFound: false,
					createIfNotFoundLocation: "",
				},
			}),
			"Line A\nLine B",
			createFile(),
		);

		expect(result).toBe("Line A\nCAPTURE\nLine B");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			result.indexOf("CAPTURE") + "CAPTURE".length,
		);
	});

	it("resolves format syntax in insert-before target lines", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);
		formatter.setTitle("Project Alpha");

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertBefore: {
					enabled: true,
					before: "{{title}}",
					createIfNotFound: false,
					createIfNotFoundLocation: "",
				},
			}),
			"# Inbox\nProject Alpha\nBody",
			createFile("Project Alpha.md"),
		);

		expect(result).toBe("# Inbox\nCAPTURE\nProject Alpha\nBody");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			result.indexOf("CAPTURE\n") + "CAPTURE\n".length,
		);
	});

	it("creates a missing insert-before target below the capture", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE",
			createChoice({
				insertBefore: {
					enabled: true,
					before: "## Missing",
					createIfNotFound: true,
					createIfNotFoundLocation: "bottom",
				},
			}),
			"# Inbox",
			createFile(),
		);

		expect(result).toBe("# Inbox\nCAPTURE\n## Missing");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			result.indexOf("CAPTURE") + "CAPTURE".length,
		);
	});

	it("keeps existing body content separated when creating a missing insert-before target at top", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE",
			createChoice({
				insertBefore: {
					enabled: true,
					before: "## Missing",
					createIfNotFound: true,
					createIfNotFoundLocation: "top",
				},
			}),
			"Body",
			createFile(),
		);

		expect(result).toBe("CAPTURE\n## Missing\nBody");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe("CAPTURE".length);
	});

	it("keeps frontmatter body content separated when creating a missing insert-before target at top", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE",
			createChoice({
				insertBefore: {
					enabled: true,
					before: "## Missing",
					createIfNotFound: true,
					createIfNotFoundLocation: "top",
				},
			}),
			"---\ntitle: Test\n---\nBody",
			createFile(),
		);

		expect(result).toBe("---\ntitle: Test\n---\nCAPTURE\n## Missing\nBody");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			result.indexOf("CAPTURE") + "CAPTURE".length,
		);
	});

	it("tracks cursor after inline insert-after in the matched occurrence", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result, cursor } = await formatter.formatContentWithFile(
			" CAPTURE",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "Status:",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: false,
					createIfNotFoundLocation: "",
					inline: true,
					replaceExisting: false,
					blankLineAfterMatchMode: "auto",
				},
			}),
			"Status: first\nStatus: second",
			createFile(),
		);

		expect(result).toBe("Status: CAPTURE first\nStatus: second");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			"Status: CAPTURE".length,
		);
	});

	it("captures a non-breaking-space-only payload instead of dropping it as empty (issue #760)", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result } = await formatter.formatContentWithFile(
			"\u00A0",
			createChoice({ captureToActiveFile: false, prepend: true }),
			"Line A\nLine B",
			createFile(),
		);

		expect(result).toBe("Line A\nLine B\n\u00A0");
	});

	it("returns a non-breaking-space-only payload from formatContentOnly (issue #760)", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const result = await formatter.formatContentOnly("\u00A0");

		expect(result).toBe("\u00A0");
	});

	it("still treats ASCII-whitespace-only payloads as empty captures", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result } = await formatter.formatContentWithFile(
			" \t\n",
			createChoice({ captureToActiveFile: false, prepend: true }),
			"Line A\nLine B",
			createFile(),
		);

		expect(result).toBe("Line A\nLine B");
	});

	it("keeps task captures separated when creating a missing insert-before target at top", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result } = await formatter.formatContentWithFile(
			"- [ ] CAPTURE",
			createChoice({
				task: true,
				insertBefore: {
					enabled: true,
					before: "## Missing",
					createIfNotFound: true,
					createIfNotFoundLocation: "top",
				},
			}),
			"Body",
			createFile(),
		);

		expect(result).toBe("- [ ] CAPTURE\n## Missing\nBody");
	});

	it("inserts under the runtime-picked heading override instead of the static after text (#738)", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		// "Under heading…" sets a verbatim line override; the static `after` is ignored.
		formatter.setInsertAfterTargetOverride("## Foo");

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "## NeverUsed",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: false,
					createIfNotFoundLocation: "",
					inline: false,
					replaceExisting: false,
					blankLineAfterMatchMode: "auto",
					promptHeading: true,
				},
			}),
			"# Title\n## Foo\nexisting\n## Bar",
			createFile(),
		);

		expect(result).toBe("# Title\n## Foo\nCAPTURE\nexisting\n## Bar");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			result.indexOf("CAPTURE\n") + "CAPTURE\n".length,
		);
	});

	it("matches the heading override literally, never resolving token-like heading text (#738)", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		// A real heading whose text contains format-token syntax. If the override were run
		// through the format pipeline, "{{DATE}}" would resolve and desync from the real
		// line (target not found → throw, since createIfNotFound is false). Landing the
		// capture proves the override is matched verbatim.
		formatter.setInsertAfterTargetOverride("## {{DATE}}");

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: false,
					createIfNotFoundLocation: "",
					inline: false,
					replaceExisting: false,
					blankLineAfterMatchMode: "auto",
					promptHeading: true,
				},
			}),
			"## {{DATE}}\nbody",
			createFile(),
		);

		expect(result).toBe("## {{DATE}}\nCAPTURE\nbody");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			result.indexOf("CAPTURE\n") + "CAPTURE\n".length,
		);
	});

	it("takes the block (section) path for a heading override even if a stale inline flag is set (#738 blocker)", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		formatter.setInsertAfterTargetOverride("## Foo");

		// inline:true is a stale flag from a prior "After line…" inline config. The override
		// must short-circuit the same-line inline path and insert on its own line under the
		// heading (belt-and-suspenders with the builder's onChange reset).
		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "## NeverUsed",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: false,
					createIfNotFoundLocation: "",
					inline: true,
					replaceExisting: true,
					blankLineAfterMatchMode: "auto",
					promptHeading: true,
				},
			}),
			"## Foo\nexisting",
			createFile(),
		);

		expect(result).toBe("## Foo\nCAPTURE\nexisting");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			result.indexOf("CAPTURE\n") + "CAPTURE\n".length,
		);
	});

	it("creates a typed heading override via create-if-not-found, byte-symmetric with search (#738/#742)", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		// User typed a heading that doesn't exist yet; "Create line if not found" creates it.
		// The created block must be byte-identical to what the next run's search will match.
		formatter.setInsertAfterTargetOverride("## Tasks");

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: true,
					createIfNotFoundLocation: "bottom",
					inline: false,
					replaceExisting: false,
					blankLineAfterMatchMode: "auto",
					promptHeading: true,
				},
			}),
			"# Title\nbody",
			createFile(),
		);

		expect(result).toBe("# Title\nbody\n## Tasks\nCAPTURE\n");
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(result.length);
	});

	it("inserts under the FIRST occurrence when the note has duplicate heading text (#738)", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		// Two identical heading lines: the picker's items collapse to one and the search
		// resolves the first match (parity with the static "After line…" field). Locked so a
		// future override refactor can't silently change which section is targeted.
		formatter.setInsertAfterTargetOverride("## Tasks");

		const { content: result, cursor } = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: false,
					createIfNotFoundLocation: "",
					inline: false,
					replaceExisting: false,
					blankLineAfterMatchMode: "auto",
					promptHeading: true,
				},
			}),
			"## Tasks\nfirst\n\n## Other\nx\n\n## Tasks\nsecond",
			createFile(),
		);

		expect(result).toBe(
			"## Tasks\nCAPTURE\nfirst\n\n## Other\nx\n\n## Tasks\nsecond",
		);
		expect(cursor.kind === "offset" ? cursor.value : null).toBe(
			result.indexOf("CAPTURE\n") + "CAPTURE\n".length,
		);
	});
});

describe("marked capture placement", () => {
	it.each(["top", "bottom", "after", "before", "inline", "missingAfter", "missingBefore", "ordered"])("keeps the marker inside its payload through %s insertion", async position => {
		const choice = new CaptureChoice("Marked capture");
		const body = "---\nstatus: active\n---\n\n## Log\nOld\n## Next\n";
		if (position === "bottom") choice.prepend = true;
		if (["after", "inline", "missingAfter", "ordered"].includes(position)) {
			choice.insertAfter.enabled = true;
			choice.insertAfter.after = position === "missingAfter" || position === "ordered" ? "## Missing" : "## Log";
			choice.insertAfter.inline = position === "inline";
			choice.insertAfter.createIfNotFound = true;
			choice.insertAfter.createIfNotFoundLocation = position === "ordered" ? "ordered" : "top";
		}
		if (position === "before" || position === "missingBefore") {
			choice.insertBefore = { enabled: true, before: position === "before" ? "## Next" : "## Missing", createIfNotFound: true, createIfNotFoundLocation: "bottom" };
		}
		const formatter = new CaptureChoiceFormatter(createMockApp(), { settings: { globalVariables: {}, enableTemplatePropertyTypes: false } } as any);
		const result = await formatter.formatContentWithFile("😀before{{cursor}}after{{CURSOR}}", choice, body, createFile());
		expect(result.captureContent).toBe("😀beforeafter");
		expect(result.content).not.toMatch(/{{cursor}}/i);
		expect(result.content).toContain("status: active");
		expect(result.cursor).toEqual({ kind: "offset", source: "marker", value: result.content.indexOf("😀before") + "😀before".length });
	});

	it("maps an ordered marker across CRLF conversion and section padding", async () => {
		const choice = new CaptureChoice("Ordered marker");
		choice.insertAfter = { ...choice.insertAfter, enabled: true, after: "## 2026-09-18", createIfNotFound: true, createIfNotFoundLocation: "ordered", orderBy: { by: "lexical", direction: "asc", unparseable: "bottom" } };
		const formatter = new CaptureChoiceFormatter(createMockApp(), { settings: { globalVariables: {}, enableTemplatePropertyTypes: false } } as any);
		const result = await formatter.formatContentWithFile("Line\n{{CURSOR}}Tail\n", choice, "## 2026-09-17\r\nOlder\r\n## 2026-09-19\r\nLater\r\n", createFile());
		expect(result.content).toContain("## 2026-09-18\r\nLine\r\nTail");
		expect(result.cursor).toEqual({ kind: "offset", source: "marker", value: result.content.indexOf("Tail") });
	});

	it("leaves existing note markers untouched and treats a marker-only payload as empty", async () => {
		const formatter = new CaptureChoiceFormatter(createMockApp(), { settings: { globalVariables: {}, enableTemplatePropertyTypes: false } } as any);
		const result = await formatter.formatContentWithFile("{{CURSOR}}", new CaptureChoice("Empty"), "Keep {{CURSOR}} literally", createFile());
		expect(result).toEqual({ content: "Keep {{CURSOR}} literally", captureContent: "", cursor: { kind: "none" }, markerOnly: true });
	});
});
