import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { SectionOrdering } from "../types/choices/ICaptureChoice";

// Mocks mirror captureChoiceFormatter-742-multiline-insert.test.ts so the
// formatter can run under jsdom without real Obsidian/Templater.
vi.mock("../utilityObsidian", () => ({
	templaterParseTemplate: vi.fn().mockResolvedValue(null),
}));
vi.mock("../gui/InputPrompt", () => ({
	__esModule: true,
	default: class {
		factory() {
			return {
				Prompt: vi.fn().mockResolvedValue(""),
				PromptWithContext: vi.fn().mockResolvedValue(""),
			} as any;
		}
	},
}));
vi.mock("../gui/InputSuggester/inputSuggester", () => ({
	__esModule: true,
	default: class {
		constructor() {}
	},
}));
vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	__esModule: true,
	default: { Suggest: vi.fn().mockResolvedValue("") },
}));
vi.mock("../gui/VDateInputPrompt/VDateInputPrompt", () => ({
	__esModule: true,
	default: { Prompt: vi.fn().mockResolvedValue("") },
}));
vi.mock("../utils/errorUtils", () => ({
	__esModule: true,
	reportError: vi.fn(),
	isCancellationError: vi.fn().mockReturnValue(false),
}));
vi.mock("../gui/MathModal", () => ({
	__esModule: true,
	MathModal: { Prompt: vi.fn().mockResolvedValue("") },
}));
vi.mock("../engine/SingleInlineScriptEngine", () => ({
	__esModule: true,
	SingleInlineScriptEngine: class {
		public params = { variables: {} as Record<string, unknown> };
		async runAndGetOutput() {
			return "";
		}
	},
}));
vi.mock("../engine/SingleMacroEngine", () => ({
	__esModule: true,
	SingleMacroEngine: class {
		async runAndGetOutput() {
			return "";
		}
	},
}));
vi.mock("../engine/SingleTemplateEngine", () => ({
	__esModule: true,
	SingleTemplateEngine: class {
		async run() {
			return "";
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
		setLinkToCurrentFileBehavior() {}
	},
}));
vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));
vi.mock("../main", () => ({
	__esModule: true,
	default: class QuickAdd {
		static instance = {
			settings: { inputPrompt: "single-line" },
			app: {
				workspace: { getActiveViewOfType: vi.fn().mockReturnValue(null) },
			},
		};
		settings = QuickAdd.instance.settings;
		app = QuickAdd.instance.app;
	},
}));

import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

/**
 * A real-enough lenient date parser injected as window.moment so the date sort is
 * exercised end-to-end through the formatter (the obsidian-stub moment is a no-op
 * with no valueOf). Supports the formats used below; leniently matches the leading
 * date and ignores trailing decoration.
 */
function installFakeMoment() {
	const fake = (input: string, format?: string) => {
		let value = Number.NaN;
		if (format === "YYYY-MM-DD") {
			const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
			if (m) value = Date.UTC(+m[1], +m[2] - 1, +m[3]);
		} else {
			const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
			if (m) value = Date.UTC(+m[1], +m[2] - 1, +m[3]);
		}
		return { isValid: () => !Number.isNaN(value), valueOf: () => value };
	};
	(global as any).window = { ...(global as any).window, moment: fake };
}

const baseInsertAfter = {
	enabled: true,
	after: "## Section",
	insertAtEnd: false,
	considerSubsections: false,
	createIfNotFound: true,
	createIfNotFoundLocation: "ordered",
	inline: false,
	replaceExisting: false,
	blankLineAfterMatchMode: "auto" as const,
	orderBy: {
		by: "insertion",
		direction: "desc",
		unparseable: "bottom",
	} as SectionOrdering,
};

const createChoice = (
	insertAfterOverrides: Partial<typeof baseInsertAfter> = {},
	overrides: Partial<ICaptureChoice> = {},
): ICaptureChoice =>
	({
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
			...baseInsertAfter,
			...insertAfterOverrides,
			orderBy: {
				...baseInsertAfter.orderBy,
				...(insertAfterOverrides.orderBy ?? {}),
			},
		},
		insertBefore: {
			enabled: false,
			before: "",
			createIfNotFound: false,
			createIfNotFoundLocation: "top",
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
	}) as ICaptureChoice;

const createMockApp = (): App =>
	({
		workspace: {
			getActiveFile: vi.fn().mockReturnValue(null),
			getActiveViewOfType: vi.fn().mockReturnValue(null),
		},
		metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
		fileManager: {
			generateMarkdownLink: vi.fn().mockReturnValue(""),
			processFrontMatter: vi.fn(),
		},
		vault: { adapter: { exists: vi.fn() }, cachedRead: vi.fn() },
	}) as unknown as App;

const createFile = (path = "Target.md"): TFile =>
	({
		path,
		name: path.split("/").pop() ?? path,
		basename: (path.split("/").pop() ?? path).replace(/\.(md|canvas)$/i, ""),
		extension: "md",
	}) as unknown as TFile;

const createFormatter = () =>
	new CaptureChoiceFormatter(createMockApp(), {
		settings: {
			inputPrompt: "single-line",
			enableTemplatePropertyTypes: false,
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as any);

async function runOnce(
	choice: ICaptureChoice,
	content: string,
	capture: string,
): Promise<string> {
	const formatter = createFormatter();
	return formatter.formatContentWithFile(capture, choice, content, createFile());
}

/** Feed each run's output back as the next run's content (real repeat-capture). */
async function runCaptures(
	choice: ICaptureChoice,
	seed: string,
	captures: string[],
): Promise<string> {
	let content = seed;
	for (const capture of captures) {
		content = await runOnce(choice, content, capture);
	}
	return content;
}

const count = (haystack: string, needle: string) =>
	haystack.split(needle).length - 1;

beforeEach(() => {
	(global as any).navigator = {
		clipboard: { readText: vi.fn().mockResolvedValue("") },
	};
	installFakeMoment();
});

describe("#481 — ordered create-if-not-found placement", () => {
	it("pins an H1 + blurb preamble above a newly created section (desc)", async () => {
		const choice = createChoice({
			after: "## NEW",
			orderBy: { by: "insertion", direction: "desc", unparseable: "bottom" },
		});
		const seed = "# My Daily Log\n\nA running journal.\n\n## OLD\n- old\n";
		const out = await runOnce(choice, seed, "- new entry\n");
		expect(out).toBe(
			"# My Daily Log\n\nA running journal.\n\n## NEW\n- new entry\n\n## OLD\n- old\n",
		);
	});

	it("creates the first-ever section after the preamble, blurb stays above", async () => {
		const choice = createChoice({
			after: "## TODAY",
			orderBy: { by: "insertion", direction: "desc", unparseable: "bottom" },
		});
		const seed = "# My Daily Log\n\nA running journal.\n";
		const out = await runOnce(choice, seed, "- first entry\n");
		expect(out).toBe(
			"# My Daily Log\n\nA running journal.\n\n## TODAY\n- first entry\n",
		);
	});

	it("is idempotent and newest-on-top within a section across repeated captures", async () => {
		const choice = createChoice({
			after: "## Log",
			insertAtEnd: false,
			orderBy: { by: "insertion", direction: "desc", unparseable: "bottom" },
		});
		const seed = "# Title\n\nblurb\n";
		const out = await runCaptures(choice, seed, [
			"- first\n",
			"- second\n",
			"- third\n",
		]);
		// Header created exactly once; entries newest-first directly under it.
		expect(count(out, "## Log")).toBe(1);
		expect(out).toBe(
			"# Title\n\nblurb\n\n## Log\n- third\n- second\n- first\n",
		);
	});

	it("date desc places a newer ISO day above an existing older day (real {{DATE}} path uses window.moment)", async () => {
		// Use literal date headings (the stub resolves {{DATE}} to a constant, so we
		// drive distinct dates literally; window.moment does the real comparison).
		const choice = createChoice({
			after: "## 2026-06-16",
			orderBy: {
				by: "date",
				direction: "desc",
				dateFormat: "YYYY-MM-DD",
				unparseable: "bottom",
			},
		});
		const seed =
			"# My Daily Log\n\nblurb\n\n## 2026-06-14\n- older entry\n";
		const out = await runOnce(choice, seed, "- new entry\n");
		expect(out).toBe(
			"# My Daily Log\n\nblurb\n\n## 2026-06-16\n- new entry\n\n## 2026-06-14\n- older entry\n",
		);
	});

	it("date desc inserts a middle day in its chronological slot", async () => {
		const choice = createChoice({
			after: "## 2026-06-12",
			orderBy: {
				by: "date",
				direction: "desc",
				dateFormat: "YYYY-MM-DD",
				unparseable: "bottom",
			},
		});
		const seed =
			"# Log\n\n## 2026-06-16\n- a\n\n## 2026-06-10\n- b\n";
		const out = await runOnce(choice, seed, "- mid\n");
		expect(out).toBe(
			"# Log\n\n## 2026-06-16\n- a\n\n## 2026-06-12\n- mid\n\n## 2026-06-10\n- b\n",
		);
	});

	it("preserves CRLF and finds CRLF siblings", async () => {
		const choice = createChoice({
			after: "## 2026-06-16",
			orderBy: {
				by: "date",
				direction: "desc",
				dateFormat: "YYYY-MM-DD",
				unparseable: "bottom",
			},
		});
		const seed =
			"# Log\r\n\r\n## 2026-06-14\r\n- older\r\n";
		const out = await runOnce(choice, seed, "- new\n");
		// New section placed above the older one; existing CRLF bytes preserved.
		expect(out).toBe(
			"# Log\r\n\r\n## 2026-06-16\r\n- new\r\n\r\n## 2026-06-14\r\n- older\r\n",
		);
		expect(out).not.toContain("## 2026-06-16\n"); // not a lone LF among CRLF
	});

	it("asc appends a new section after the band (oldest/lowest first)", async () => {
		const choice = createChoice({
			after: "## C",
			insertAtEnd: true,
			orderBy: { by: "lexical", direction: "asc", unparseable: "bottom" },
		});
		const seed = "# Items\n\n## A\n- a\n\n## B\n- b\n";
		const out = await runOnce(choice, seed, "- c\n");
		expect(out).toBe("# Items\n\n## A\n- a\n\n## B\n- b\n\n## C\n- c\n");
	});

	it("never splices into YAML frontmatter (H1 ordered choice with a '#' comment in frontmatter)", async () => {
		const choice = createChoice({
			after: "# 2026",
			orderBy: { by: "insertion", direction: "desc", unparseable: "bottom" },
		});
		// A frontmatter line "# my yaml comment" matches the ATX heading regex.
		const seed = "---\n# my yaml comment\ntags: x\n---\n# Title\nblurb\n";
		const out = await runOnce(choice, seed, "- entry\n");
		// Frontmatter block stays intact; the new H1 lands in the body (above "# Title").
		expect(out).toContain("---\n# my yaml comment\ntags: x\n---\n");
		expect(out).toBe(
			"---\n# my yaml comment\ntags: x\n---\n\n# 2026\n- entry\n\n# Title\nblurb\n",
		);
	});

	it("places the first dated section after frontmatter, not above it", async () => {
		const choice = createChoice({
			after: "## 2026-06-16",
			orderBy: {
				by: "date",
				direction: "desc",
				dateFormat: "YYYY-MM-DD",
				unparseable: "bottom",
			},
		});
		const seed = "---\ntype: log\n---\n# My Daily Log\n\nblurb\n";
		const out = await runOnce(choice, seed, "- entry\n");
		expect(out).toBe(
			"---\ntype: log\n---\n# My Daily Log\n\nblurb\n\n## 2026-06-16\n- entry\n",
		);
	});

	it("does not normalize a mixed-EOL file's existing line endings", async () => {
		const choice = createChoice({
			after: "## 2026-06-16",
			orderBy: {
				by: "date",
				direction: "desc",
				dateFormat: "YYYY-MM-DD",
				unparseable: "bottom",
			},
		});
		// One CRLF line ("## 2026-06-14\r\n") amid otherwise-LF content.
		const seed = "# Log\n\n## 2026-06-14\r\n- old\n";
		const out = await runOnce(choice, seed, "- new\n");
		// Existing LF lines stay LF; the existing CRLF line stays CRLF; only the
		// inserted lines adopt the dominant (CRLF) ending.
		expect(out).toBe(
			"# Log\n\n## 2026-06-16\r\n- new\r\n\r\n## 2026-06-14\r\n- old\n",
		);
		expect(out).toContain("# Log\n\n"); // not flipped to CRLF
		expect(out).toContain("- old\n"); // trailing LF line preserved
	});

	it("does not duplicate a heading when a multi-line anchor's tail is missing (idempotency)", async () => {
		// Multi-line anchor: heading + a "**Tasks**" sub-line. The note already has a
		// bare "## 2026-06-16" (e.g. from another source) WITHOUT the **Tasks** line,
		// so the full-block search reports "not found". Ordered create must NOT add a
		// second "## 2026-06-16"; it inserts the entry under the existing heading.
		const choice = createChoice({
			after: "## 2026-06-16\\n**Tasks**",
			orderBy: {
				by: "date",
				direction: "desc",
				dateFormat: "YYYY-MM-DD",
				unparseable: "bottom",
			},
		});
		const seed = "# Log\n\n## 2026-06-16\n- existing\n";
		const out = await runOnce(choice, seed, "- new\n");
		expect(count(out, "## 2026-06-16")).toBe(1);
		expect(out).toBe("# Log\n\n## 2026-06-16\n- new\n- existing\n");
	});

	it("does not treat a fenced '## …' as the existing heading (dedup guard is fence-aware)", async () => {
		// Multi-line anchor; the only "## 2026-06-16" in the note is inside a code
		// fence. The dedup guard must NOT match it (which would insert into the code
		// block) — it should create a real sorted section instead.
		const choice = createChoice({
			after: "## 2026-06-16\\n**Tasks**",
			orderBy: {
				by: "date",
				direction: "desc",
				dateFormat: "YYYY-MM-DD",
				unparseable: "bottom",
			},
		});
		const seed =
			"# Log\n\n```md\n## 2026-06-16\n```\n\n## 2026-06-14\n- old\n";
		const out = await runOnce(choice, seed, "- new\n");
		// The fenced block is untouched; a real section is created before 06-14.
		expect(out).toContain("```md\n## 2026-06-16\n```");
		expect(count(out, "**Tasks**")).toBe(1);
		expect(out).toBe(
			"# Log\n\n```md\n## 2026-06-16\n```\n\n## 2026-06-16\n**Tasks**\n- new\n\n## 2026-06-14\n- old\n",
		);
	});

	it("appends at EOF of a CRLF file with no trailing newline without a dangling CR", async () => {
		const choice = createChoice({
			after: "## 1.9.0",
			insertAtEnd: true,
			orderBy: { by: "semver", direction: "desc", unparseable: "bottom" },
		});
		// CRLF file, NO trailing newline, append an older version at EOF.
		const seed = "# Changelog\r\n\r\n## 2.0.0\r\n- big";
		const out = await runOnce(choice, seed, "- old\n");
		expect(out).toBe(
			"# Changelog\r\n\r\n## 2.0.0\r\n- big\r\n\r\n## 1.9.0\r\n- old",
		);
		expect(out).not.toMatch(/\r(?!\n)/); // no bare CR not followed by LF
	});

	it("does not duplicate the header on the second same-day run (found-path)", async () => {
		const choice = createChoice({
			after: "## 2026-06-16",
			insertAtEnd: false,
			orderBy: {
				by: "date",
				direction: "desc",
				dateFormat: "YYYY-MM-DD",
				unparseable: "bottom",
			},
		});
		const seed = "# Log\n\n## 2026-06-14\n- old\n";
		const out = await runCaptures(choice, seed, ["- first\n", "- second\n"]);
		expect(count(out, "## 2026-06-16")).toBe(1);
		expect(out).toBe(
			"# Log\n\n## 2026-06-16\n- second\n- first\n\n## 2026-06-14\n- old\n",
		);
	});
});
