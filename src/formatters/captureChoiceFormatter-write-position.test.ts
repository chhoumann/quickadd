import { createMockApp } from "../../tests/helpers/formatters/captureFixtures";
import { createCaptureFormatterPlugin } from "../../tests/helpers/formatters/plugin";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TFile } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

vi.mock("../utilityObsidian", async () => (await import("../../tests/helpers/formatters/mocks")).utilityObsidianMock());

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
		vi.stubGlobal("navigator", {
			clipboard: {
				readText: vi.fn().mockResolvedValue(""),
			},
		});
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

	it("starts an empty note with the capture, not a blank line, when writing to the bottom", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			createCaptureFormatterPlugin(),
		);

		const { content: result } = await formatter.formatContentWithFile(
			"- First idea",
			createChoice({ captureToActiveFile: false, prepend: true }),
			"",
			createFile(),
		);

		expect(result).toBe("- First idea");
	});

	it("keeps a list tight when the bottom capture's format ends with a line break", async () => {
		const choice = createChoice({ captureToActiveFile: false, prepend: true });
		let note = "- a\n";
		for (const entry of ["- first\n", "- second\n"]) {
			const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
			note = (await formatter.formatContentWithFile(entry, choice, note, createFile())).content;
		}

		expect(note).toBe("- a\n- first\n- second\n");
	});

	it("keeps the blank line a bottom capture's format asks for", async () => {
		const choice = createChoice({ captureToActiveFile: false, prepend: true });
		const append = async (entry: string, note: string) =>
			(await new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin())
				.formatContentWithFile(entry, choice, note, createFile())).content;

		expect(await append("\nsecond", "first")).toBe("first\n\nsecond");
		expect(await append("\nsecond", "first\n")).toBe("first\n\nsecond");
		expect(await append("second\n\n", "first\n\n")).toBe("first\n\nsecond\n\n");
	});

	it("puts a heading it creates at the bottom on the next line, not after a blank line", async () => {
		const choice = createChoice({
			insertAfter: {
				...createChoice().insertAfter,
				enabled: true,
				after: "## Log",
				createIfNotFound: true,
				createIfNotFoundLocation: "bottom",
			},
		});
		const capture = async (note: string) =>
			(await new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin())
				.formatContentWithFile("- first", choice, note, createFile())).content;

		expect(await capture("")).toBe("## Log\n- first");
		expect(await capture("# Inbox")).toBe("# Inbox\n## Log\n- first");
		expect(await capture("# Inbox\n")).toBe("# Inbox\n## Log\n- first");
	});

	it("ends a callout at the next heading or the end of the note when inserting at the end of its section (#1926)", async () => {
		const choice = createChoice({
			insertAfter: {
				...createChoice().insertAfter,
				enabled: true,
				after: "> [!info]- Captured today",
				insertAtEnd: true,
			},
		});
		const capture = async (note: string) =>
			(await new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin())
				.formatContentWithFile("> two\n", choice, note, createFile())).content;

		expect(await capture("> [!info]- Captured today\n> one\n## Journal\n- entry\n")).toBe(
			"> [!info]- Captured today\n> one\n> two\n## Journal\n- entry\n",
		);
		expect(await capture("## Journal\n> [!info]- Captured today\n> one")).toBe(
			"## Journal\n> [!info]- Captured today\n> one\n> two\n",
		);
	});

	it("inserts after a code fence below a non-heading line, not at a # line inside it (#1926)", async () => {
		const choice = createChoice({
			insertAfter: {
				...createChoice().insertAfter,
				enabled: true,
				after: "Setup steps:",
				insertAtEnd: true,
			},
		});
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		const { content } = await formatter.formatContentWithFile(
			"- run the tests\n",
			choice,
			"Setup steps:\n```bash\n# install deps\npnpm install\n```\n\n## Next\n",
			createFile(),
		);

		expect(content).toBe(
			"Setup steps:\n```bash\n# install deps\npnpm install\n```\n- run the tests\n\n## Next\n",
		);
	});

	it.each([false, true])(
		"ends a heading's section after its code fence, not at a # line inside it (considerSubsections: %s) (#1968)",
		async (considerSubsections) => {
			const choice = createChoice({
				insertAfter: {
					...createChoice().insertAfter,
					enabled: true,
					after: "## Log",
					insertAtEnd: true,
					considerSubsections,
				},
			});
			const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
			const { content } = await formatter.formatContentWithFile(
				"- captured\n",
				choice,
				"## Log\n- first entry\n\n```bash\n# comment\necho hi\n```\n\n- second entry\n\n## Next\n- untouched\n",
				createFile(),
			);

			expect(content).toBe(
				"## Log\n- first entry\n\n```bash\n# comment\necho hi\n```\n\n- second entry\n- captured\n\n## Next\n- untouched\n",
			);
		},
	);

	it("does not read an inline-code line as a fence when ending a heading's section (#1968)", async () => {
		const choice = createChoice({
			insertAfter: {
				...createChoice().insertAfter,
				enabled: true,
				after: "## Log",
				insertAtEnd: true,
			},
		});
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		const { content } = await formatter.formatContentWithFile(
			"- captured\n",
			choice,
			"## Log\n```inline```\n\n## Next\n- untouched\n",
			createFile(),
		);

		expect(content).toBe("## Log\n```inline```\n- captured\n\n## Next\n- untouched\n");
	});

	it.each([
		[
			"# Header one\n## Pre-existing header\nPre-existing text",
			"# Header one\n## Pre-existing header\nPre-existing text\n## Capture header\nSome capture text",
		],
		[
			"# Header one\n## Pre-existing header\nPre-existing text\n# Header two\n",
			"# Header one\n## Pre-existing header\nPre-existing text\n## Capture header\nSome capture text\n# Header two\n",
		],
	])("keeps a subsection's text with its heading when inserting at the end of the section with subsections (#2029): %j", async (note, expected) => {
		const choice = createChoice({
			insertAfter: {
				...createChoice().insertAfter,
				enabled: true,
				after: "# Header one",
				insertAtEnd: true,
				considerSubsections: true,
			},
		});
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		const { content } = await formatter.formatContentWithFile(
			"## Capture header\nSome capture text",
			choice,
			note,
			createFile(),
		);

		expect(content).toBe(expected);
	});

	it.each([
		["## Log\n## Next\n", "## Log\n- captured\n## Next\n"],
		["## Log\nNext\n---\n", "## Log\n- captured\nNext\n---\n"],
	])("writes into an empty first section, not under the heading after it: %j", async (note, expected) => {
		const choice = createChoice({
			insertAfter: {
				...createChoice().insertAfter,
				enabled: true,
				after: "## Log",
				insertAtEnd: true,
			},
		});
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		const { content } = await formatter.formatContentWithFile("- captured\n", choice, note, createFile());

		expect(content).toBe(expected);
	});

	it.each([
		["a %% comment block", "%%\n# draft idea\n%%"],
		["a $$ math block", "$$\n# x = 1\n$$"],
	])("ends a heading's section after %s, not at a # line inside it", async (_what, block) => {
		const choice = createChoice({
			insertAfter: { ...createChoice().insertAfter, enabled: true, after: "## Log", insertAtEnd: true },
		});
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		const { content } = await formatter.formatContentWithFile(
			"- captured\n",
			choice,
			`## Log\n- first\n\n${block}\n- second\n\n## Next\n`,
			createFile(),
		);

		expect(content).toBe(`## Log\n- first\n\n${block}\n- second\n- captured\n\n## Next\n`);
	});

	it("includes subsections in a CRLF note's section end (#2022)", async () => {
		const choice = createChoice({
			insertAfter: {
				...createChoice().insertAfter,
				enabled: true,
				after: "## Log",
				insertAtEnd: true,
				considerSubsections: true,
			},
		});
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		const { content } = await formatter.formatContentWithFile(
			"- captured\n",
			choice,
			"## Log\r\n- first\r\n\r\n### Sub\r\n- sub\r\n\r\n## Next\r\n- untouched\r\n",
			createFile(),
		);

		const at = content.indexOf("- captured");
		expect(at).toBeGreaterThan(content.indexOf("- sub"));
		expect(at).toBeLessThan(content.indexOf("## Next"));
	});

	it("finds the section end when a note opens with a rule and no frontmatter (#1968)", async () => {
		const choice = createChoice({
			insertAfter: {
				...createChoice().insertAfter,
				enabled: true,
				after: "## Log",
				insertAtEnd: true,
			},
		});
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		const { content } = await formatter.formatContentWithFile(
			"- captured\n",
			choice,
			"---\n## Log\n- first entry\n\n## Next\n- untouched\n",
			createFile(),
		);

		expect(content).toBe("---\n## Log\n- first entry\n- captured\n\n## Next\n- untouched\n");
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

	it("inserts under an indented heading picked at runtime (#1987)", async () => {
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		formatter.setInsertAfterTargetOverride("### Indented");
		const choice = createChoice({
			insertAfter: { ...createChoice().insertAfter, enabled: true, after: "", promptHeading: true },
		});
		const { content } = await formatter.formatContentWithFile(
			"- captured\n",
			choice,
			"## Log\n   ### Indented\n- a\n",
			createFile(),
		);

		expect(content).toBe("## Log\n   ### Indented\n- captured\n- a\n");
	});

	it.each([
		["frontmatter", "---\nnote: |\n  ## Log\n---\n## Log\n- entry\n", "---\nnote: |\n  ## Log\n---\n## Log\n- captured\n- entry\n"],
		["a code fence", "```md\n## Log\n```\n## Log\n- entry\n", "```md\n## Log\n```\n## Log\n- captured\n- entry\n"],
		["a plain line", "Log notes: ## Log\n## Log\n- entry\n", "Log notes: ## Log\n## Log\n- captured\n- entry\n"],
	])("inserts under the picked heading, not a same-text line in %s (#1987)", async (_where, note, expected) => {
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		formatter.setInsertAfterTargetOverride("## Log");
		const choice = createChoice({
			insertAfter: { ...createChoice().insertAfter, enabled: true, after: "", promptHeading: true },
		});
		const { content } = await formatter.formatContentWithFile("- captured\n", choice, note, createFile());

		expect(content).toBe(expected);
	});

	it("still finds a typed line that isn't a heading, so a second run doesn't duplicate it", async () => {
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		formatter.setInsertAfterTargetOverride("Tasks:");
		const choice = createChoice({
			insertAfter: { ...createChoice().insertAfter, enabled: true, after: "", promptHeading: true, createIfNotFound: true },
		});
		const { content } = await formatter.formatContentWithFile("- captured\n", choice, "## Log\nTasks:\n- a\n", createFile());

		expect(content).toBe("## Log\nTasks:\n- captured\n- a\n");
	});

	it("inserts under a picked heading in a CRLF note (#1987)", async () => {
		const formatter = new CaptureChoiceFormatter(createMockApp(), createCaptureFormatterPlugin());
		formatter.setInsertAfterTargetOverride("## Log");
		const choice = createChoice({
			insertAfter: { ...createChoice().insertAfter, enabled: true, after: "", promptHeading: true },
		});
		const { content } = await formatter.formatContentWithFile("- captured\n", choice, "## Log\r\n- entry\r\n", createFile());

		expect(content).toContain("- captured");
		expect(content.indexOf("- captured")).toBeLessThan(content.indexOf("- entry"));
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
