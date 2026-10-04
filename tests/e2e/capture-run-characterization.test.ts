import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { lowerNode } from "../../src/v3/lower";
import { migrateChoice } from "../../src/v3/migrate";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";

/**
 * Pins what one Capture run does end to end, across the paths CaptureChoiceEngine.run()
 * dispatches: every write position, a new note or an existing one, Canvas cards, editor
 * insertion or a disk write, property capture, one entry per line, {{DAILY}} targets and
 * the cursor. Each case records the run's result, every file it watches, the notices, the
 * clipboard, and the active file with its selections. Templater's trigger-on-create has
 * its own suite (templater-new-file-trigger).
 */
const getContext = createQuickAddE2EHarness("capture-run-characterization");

const NOTE = "# Title\n\n## Log\n- one\n\n## Next\n- two\n";
const CARD = "## Log\n- one";
const SENTINEL = "clipboard-before-run";

interface Observation {
	result: Record<string, unknown>;
	files: Record<string, string | null>;
	active: string | null;
	/** The active editor's selections as `line:ch`, or `from-to` for a range. */
	selections: string[] | null;
	notices: string[];
	clipboard: string;
}

interface Arrange {
	choice: CaptureChoice;
	/** Seeds a file in the sandbox and watches it. Returns its vault path. */
	file(name: string, content: string): Promise<string>;
	/** A sandbox path to watch that does not exist yet. */
	path(name: string): string;
	/** The file open in the active editor when the run starts (default: Origin.md). */
	open(path: string, cursor?: { line: number; ch: number }): void;
	vars: Record<string, string>;
	date?: string;
	/** Turns on Daily notes with `folder` inside the sandbox. */
	dailyNotes(options: { folder: string; format: string; template: string }): Promise<void>;
}

type Case = [name: string, arrange: (a: Arrange) => Promise<void>, expected: Observation];

const canvasJson = (nodes: Record<string, unknown>[]) =>
	JSON.stringify({ nodes: nodes.map((node) => ({ x: 0, y: 0, width: 300, height: 200, ...node })), edges: [] });

let caseNumber = 0;
let dir = "";

/**
 * How the case's choice reaches data.json: as built, or migrated to a v3 action
 * and lowered back to the v2 choice the engines run. Both must observe the same.
 */
type Mode = (choice: IChoice) => IChoice;
const MODES: [string, Mode][] = [
	["v2", (choice) => choice],
	["v3 migrated and lowered", (choice) => lowerNode(migrateChoice(choice).node)],
];

async function arrangeAndRun(arrange: Case[1], mode: Mode): Promise<() => Promise<Observation>> {
	const { obsidian, plugin, sandbox } = getContext();
	// Each case works in its own folder, deleted afterwards, so a file name is unique
	// in the vault and links to it stay short.
	dir = `case-${++caseNumber}`;
	const root = `${sandbox.path(dir)}/`;
	const watched: string[] = [];
	const choice = new CaptureChoice("Characterization");
	choice.onePageInput = "never";
	choice.format = { enabled: true, format: "- NEW" };
	let opened = { path: "", cursor: { line: 0, ch: 0 } };
	const a: Arrange = {
		choice,
		file: async (name, content) => {
			const path = await seedVaultFile(obsidian, sandbox, `${dir}/${name}`, content);
			watched.push(path);
			return path;
		},
		path: (name) => {
			const path = sandbox.path(`${dir}/${name}`);
			watched.push(path);
			return path;
		},
		open: (path, cursor = { line: 0, ch: 0 }) => { opened = { path, cursor }; },
		vars: {},
		dailyNotes: async (options) => {
			await obsidian.dev.evalJsonAsync(`(async () => {
				const plugin = app.internalPlugins.getPluginById("daily-notes");
				if (!plugin.enabled) await plugin.enable(true);
				plugin.instance.options = ${JSON.stringify({ ...options, folder: sandbox.path(`${dir}/${options.folder}`) })};
				return true;
			})()`);
		},
	};
	const origin = await a.file("Origin.md", "origin line\n");
	a.open(origin);
	await arrange(a);

	await plugin.data<{ choices: IChoice[]; showCaptureNotification: boolean }>().patch(withStoredChoices((data) => {
		data.choices.push(mode(choice));
		data.showCaptureNotification = true;
	}));
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJsonAsync(`(async () => {
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(opened.path)});
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(file, { state: { mode: "source" } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		if (file.extension === "canvas") {
			const canvas = leaf.view.canvas;
			const node = [...canvas.nodes.values()][0];
			canvas.selectOnly(node);
		} else {
			leaf.view.editor.setCursor(${JSON.stringify(opened.cursor)});
			leaf.view.editor.focus();
		}
		for (const notice of document.querySelectorAll(".notice")) notice.remove();
		// Notices expire after a few seconds, so keep every one the run raises.
		window.__qaCharacterizeObserver?.disconnect();
		window.__qaCharacterizeNotices = [];
		window.__qaCharacterizeObserver = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.addedNodes) {
					if (node instanceof HTMLElement && node.classList.contains("notice")) window.__qaCharacterizeNotices.push(node);
				}
			}
		});
		window.__qaCharacterizeObserver.observe(document.body, { childList: true, subtree: true });
		await navigator.clipboard.writeText(${JSON.stringify(SENTINEL)});
		return true;
	})()`);

	const params: Record<string, string | boolean> = { id: choice.id, verify: true };
	if (Object.keys(a.vars).length > 0) params.vars = JSON.stringify(a.vars);
	if (a.date) params.date = a.date;
	const result = await obsidian.execJson<Record<string, unknown>>("quickadd:run", params);
	// The choice's generated id and the run's duration differ on every run.
	for (const key of ["command", "choice", "durationMs"]) delete result[key];

	const strip = (text: string) => text.split(root).join("");
	const observe = async (): Promise<Observation> => {
		const state = await obsidian.dev.evalJsonAsync<Omit<Observation, "result">>(`(async () => {
			for (const leaf of app.workspace.getLeavesOfType("markdown")) await leaf.view.save?.();
			const files = {};
			for (const path of ${JSON.stringify(watched)}) {
				const file = app.vault.getAbstractFileByPath(path);
				files[path] = file ? await app.vault.read(file) : null;
			}
			const view = app.workspace.activeLeaf?.view;
			return {
				files,
				active: app.workspace.getActiveFile()?.path ?? null,
				selections: view?.editor
					? view.editor.listSelections().map(({ anchor, head }) => {
						const at = (pos) => pos.line + ":" + pos.ch;
						return at(anchor) === at(head) ? at(head) : at(anchor) + "-" + at(head);
					})
					: null,
				notices: window.__qaCharacterizeNotices.map((notice) => notice.textContent?.trim() ?? ""),
				clipboard: await navigator.clipboard.readText(),
			};
		})()`);
		return JSON.parse(strip(JSON.stringify({ result, ...state }))) as Observation;
	};
	return observe;
}

let dailyNotesBefore: unknown;
beforeEach(async () => {
	dailyNotesBefore = await getContext().obsidian.dev.evalJson(`(() => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		return { enabled: plugin.enabled, options: plugin.instance.options };
	})()`);
});
afterEach(async () => {
	const { obsidian, sandbox } = getContext();
	await obsidian.dev.evalJsonAsync(`(async () => {
		const folder = app.vault.getAbstractFileByPath(${JSON.stringify(sandbox.path(dir))});
		if (folder) await app.vault.delete(folder, true);
		window.__qaCharacterizeObserver?.disconnect();
		delete window.__qaCharacterizeObserver;
		delete window.__qaCharacterizeNotices;
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		const state = ${JSON.stringify(dailyNotesBefore)};
		if (state.enabled && !plugin.enabled) await plugin.enable(true);
		if (!state.enabled && plugin.enabled) await plugin.disable(true);
		plugin.instance.options = state.options;
		return true;
	})()`);
});

const note = (a: Arrange) => a.file("Target.md", NOTE).then((path) => { a.choice.captureTo = path; return path; });

const CASES: Case[] = [
	// Existing note, written on disk while another note is open.
	["top of an existing note", async (a) => { await note(a); }, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "- NEW\n# Title\n\n## Log\n- one\n\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["bottom of an existing note", async (a) => { await note(a); a.choice.prepend = true; }, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- NEW",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["after a heading, top of its section", async (a) => {
		await note(a);
		Object.assign(a.choice.insertAfter, { enabled: true, after: "## Log", insertAtEnd: false });
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- NEW\n- one\n\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["after a heading, end of its section", async (a) => {
		await note(a);
		Object.assign(a.choice.insertAfter, { enabled: true, after: "## Log", insertAtEnd: true });
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n- NEW\n\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["after a missing heading, created at the bottom", async (a) => {
		await note(a);
		Object.assign(a.choice.insertAfter, { enabled: true, after: "## Missing", createIfNotFound: true, createIfNotFoundLocation: "bottom" });
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n## Missing\n- NEW",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["after a missing heading, not created", async (a) => {
		await note(a);
		Object.assign(a.choice.insertAfter, { enabled: true, after: "## Missing", createIfNotFound: false });
	}, {
		result: { ok: false, aborted: true, error: "Insert-after target not found: '## Missing'." },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Capture execution aborted: Insert-after target not found: '## Missing'."],
		clipboard: SENTINEL,
	}],
	["before a line", async (a) => {
		await note(a);
		a.choice.insertBefore = { enabled: true, before: "## Next", createIfNotFound: false, createIfNotFoundLocation: "top" };
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n- NEW\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a task at the bottom", async (a) => { await note(a); a.choice.prepend = true; a.choice.task = true; a.choice.format.format = "Do it"; }, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- [ ] Do it\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["an empty value", async (a) => { await note(a); a.choice.format.format = "{{VALUE}}"; a.vars.value = ""; }, {
		result: { ok: true, verified: true, effect: "unchanged", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["only a cursor marker", async (a) => { await note(a); a.choice.format.format = "{{CURSOR}}"; }, {
		result: { ok: true, verified: true, effect: "unchanged", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["opening the note at the cursor marker", async (a) => {
		await note(a);
		a.choice.prepend = true;
		a.choice.openFile = true;
		a.choice.format.format = "- {{CURSOR}}NEW";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- NEW",
		},
		active: "Target.md",
		selections: ["7:2"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["opening the note with two cursor markers", async (a) => {
		await note(a);
		a.choice.prepend = true;
		a.choice.openFile = true;
		a.choice.format.format = "- {{CURSOR}}A\n- {{CURSOR}}B";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- A\n- B",
		},
		active: "Target.md",
		selections: ["7:2"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["copying a link to the captured note", async (a) => { await note(a); a.choice.copyLinkToClipboard = true; }, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "- NEW\n# Title\n\n## Log\n- one\n\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Copied link to 'Target' to clipboard."],
		clipboard: "[[Target]]",
	}],
	["appending a link to the active note", async (a) => { await note(a); a.choice.appendLink = true; }, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "[[Target]]origin line\n",
			"Target.md": "- NEW\n# Title\n\n## Log\n- one\n\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:10"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["one entry per line", async (a) => {
		await note(a);
		a.choice.prepend = true;
		a.choice.eachLine = true;
		a.choice.format.format = "- {{VALUE}}";
		a.vars.value = "first\nsecond";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- first\n- second",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a |multi value into an existing note", async (a) => {
		await note(a);
		a.choice.prepend = true;
		a.choice.format.format = "- {{VALUE:tags|multi}}";
		a.vars.tags = "x";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- x",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [
			"QuickAdd: (WARNING) {{VALUE:…|multi}}, {{FILE:…|multi}} and {{FIELD:…|multi}} in this capture write comma-separated strings by default. Add |format:yaml, |format:markdown, |format:inline or |format:spaced to choose the output explicitly.",
		],
		clipboard: SENTINEL,
	}],
	["a heading picker in a run without ui", async (a) => {
		await note(a);
		Object.assign(a.choice.insertAfter, { enabled: true, after: "", promptHeading: true });
	}, {
		result: { ok: false, aborted: true, error: "'Characterization' needs to ask which heading to capture under, but this run is non-interactive. Turn off \"Choose heading when capturing\" and set a fixed heading, or re-run with the ui flag." },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Capture execution aborted: 'Characterization' needs to ask which heading to capture under, but this run is non-interactive. Turn off \"Choose heading when capturing\" and set a fixed heading, or re-run with the ui flag."],
		clipboard: SENTINEL,
	}],

	// New notes.
	["a new note in new folders", async (a) => {
		a.choice.captureTo = a.path("new/deep/Created.md");
		a.choice.createFileIfItDoesntExist.enabled = true;
	}, {
		result: { ok: true, verified: true, effect: "created", file: "new/deep/Created.md" },
		files: {
			"Origin.md": "origin line\n",
			"new/deep/Created.md": "- NEW",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a new note from a template", async (a) => {
		const template = await a.file("Template.md", "# From template\n\n## Log\n");
		a.choice.captureTo = a.path("Created.md");
		a.choice.createFileIfItDoesntExist = { enabled: true, createWithTemplate: true, template };
		Object.assign(a.choice.insertAfter, { enabled: true, after: "## Log" });
	}, {
		result: { ok: true, verified: true, effect: "created", file: "Created.md" },
		files: {
			"Origin.md": "origin line\n",
			"Template.md": "# From template\n\n## Log\n",
			"Created.md": "# From template\n\n## Log\n- NEW",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a new note whose capture is its front matter", async (a) => {
		a.choice.captureTo = a.path("Created.md");
		a.choice.createFileIfItDoesntExist.enabled = true;
		a.choice.format.format = "---\nstatus: {{VALUE:status}}\n---\nbody";
		a.vars.status = "open";
	}, {
		result: { ok: true, verified: true, effect: "created", file: "Created.md" },
		files: {
			"Origin.md": "origin line\n",
			"Created.md": "---\nstatus: open\n---\nbody",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a missing note without creation", async (a) => { a.choice.captureTo = a.path("Missing.md"); }, {
		result: { ok: false, aborted: true, error: "Target file missing: Missing.md. Enable \"Create file if it doesn't exist\" or choose an existing file." },
		files: {
			"Origin.md": "origin line\n",
			"Missing.md": null,
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Capture execution aborted: Target file missing: Missing.md. Enable \"Create file if it doesn't exist\" or choose an existing file."],
		clipboard: SENTINEL,
	}],
	["a new note at a path that cannot exist", async (a) => {
		a.choice.captureTo = a.path("bad:name.md");
		a.choice.createFileIfItDoesntExist.enabled = true;
	}, {
		result: { ok: false, aborted: true, error: "Cannot create \"bad:name.md\": a file or folder name cannot contain \":\". Check your own text and tokens like {{TIME}}, which is HH:mm." },
		files: {
			"Origin.md": "origin line\n",
			"bad:name.md": null,
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Capture execution aborted: Cannot create \"bad:name.md\": a file or folder name cannot contain \":\". Check your own text and tokens like {{TIME}}, which is HH:mm."],
		clipboard: SENTINEL,
	}],
	["a new note with only a cursor marker", async (a) => {
		a.choice.captureTo = a.path("Created.md");
		a.choice.createFileIfItDoesntExist.enabled = true;
		a.choice.format.format = "{{CURSOR}}";
	}, {
		result: { ok: true, verified: true, effect: "unchanged" },
		files: {
			"Origin.md": "origin line\n",
			"Created.md": null,
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Nothing to capture (no content)"],
		clipboard: SENTINEL,
	}],
	["a heading picker for a new note at a path that cannot exist", async (a) => {
		a.choice.captureTo = a.path("bad:name.md");
		a.choice.createFileIfItDoesntExist.enabled = true;
		Object.assign(a.choice.insertAfter, { enabled: true, after: "", promptHeading: true });
	}, {
		result: { ok: false, aborted: true, error: "Cannot create \"bad:name.md\": a file or folder name cannot contain \":\". Check your own text and tokens like {{TIME}}, which is HH:mm." },
		files: {
			"Origin.md": "origin line\n",
			"bad:name.md": null,
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Capture execution aborted: Cannot create \"bad:name.md\": a file or folder name cannot contain \":\". Check your own text and tokens like {{TIME}}, which is HH:mm."],
		clipboard: SENTINEL,
	}],
	["today's daily note, created from its template", async (a) => {
		const template = await a.file("Daily template.md", "# Daily\n\n## Log\n");
		await a.dailyNotes({ folder: "Journal", format: "YYYY-MM-DD", template: template.replace(/\.md$/, "") });
		a.path("Journal/2031-02-10.md");
		a.choice.captureTo = "{{DAILY}}";
		a.choice.createFileIfItDoesntExist.enabled = true;
		Object.assign(a.choice.insertAfter, { enabled: true, after: "## Log" });
		a.date = "2031-02-10";
	}, {
		result: { ok: true, verified: true, effect: "created", file: "Journal/2031-02-10.md" },
		files: {
			"Origin.md": "origin line\n",
			"Daily template.md": "# Daily\n\n## Log\n",
			"Journal/2031-02-10.md": "# Daily\n\n## Log\n- NEW",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["an existing daily note", async (a) => {
		await a.dailyNotes({ folder: "Journal", format: "YYYY-MM-DD", template: "" });
		await a.file("Journal/2031-02-10.md", "# Existing daily\n");
		a.choice.captureTo = "{{DAILY}}";
		a.choice.prepend = true;
		a.date = "2031-02-10";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Journal/2031-02-10.md" },
		files: {
			"Origin.md": "origin line\n",
			"Journal/2031-02-10.md": "# Existing daily\n- NEW",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],

	// The active note, written in its editor.
	["at the cursor in the active note", async (a) => {
		a.open(await note(a), { line: 3, ch: 5 });
		a.choice.captureToActiveFile = true;
		a.choice.format.format = " NEW";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one NEW\n\n## Next\n- two\n",
		},
		active: "Target.md",
		selections: ["3:9"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["on a new line above the cursor", async (a) => {
		a.open(await note(a), { line: 3, ch: 2 });
		a.choice.captureToActiveFile = true;
		a.choice.newLineCapture = { enabled: true, direction: "above" };
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- NEW\n- one\n\n## Next\n- two\n",
		},
		active: "Target.md",
		selections: ["3:5"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["on a new line below the cursor", async (a) => {
		a.open(await note(a), { line: 3, ch: 2 });
		a.choice.captureToActiveFile = true;
		a.choice.newLineCapture = { enabled: true, direction: "below" };
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n- NEW\n\n## Next\n- two\n",
		},
		active: "Target.md",
		selections: ["4:5"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["top of the active note", async (a) => {
		a.open(await note(a), { line: 3, ch: 2 });
		a.choice.captureToActiveFile = true;
		a.choice.activeFileWritePosition = "top";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "- NEW\n# Title\n\n## Log\n- one\n\n## Next\n- two\n",
		},
		active: "Target.md",
		selections: ["4:2"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["bottom of the active note", async (a) => {
		a.open(await note(a), { line: 3, ch: 2 });
		a.choice.captureToActiveFile = true;
		a.choice.activeFileWritePosition = "bottom";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- NEW",
		},
		active: "Target.md",
		selections: ["3:2"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["after a heading in the active note", async (a) => {
		a.open(await note(a), { line: 0, ch: 0 });
		a.choice.captureToActiveFile = true;
		Object.assign(a.choice.insertAfter, { enabled: true, after: "## Log", insertAtEnd: false });
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- NEW\n- one\n\n## Next\n- two\n",
		},
		active: "Target.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a cursor marker at the cursor in the active note", async (a) => {
		a.open(await note(a), { line: 3, ch: 5 });
		a.choice.captureToActiveFile = true;
		a.choice.format.format = " A{{CURSOR}}B";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one AB\n\n## Next\n- two\n",
		},
		active: "Target.md",
		selections: ["3:7"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a cursor marker and a link in the same active note", async (a) => {
		a.open(await note(a), { line: 3, ch: 5 });
		a.choice.captureToActiveFile = true;
		a.choice.activeFileWritePosition = "bottom";
		a.choice.appendLink = true;
		a.choice.format.format = "- {{CURSOR}}NEW";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one[[Target]]\n\n## Next\n- two\n- NEW",
		},
		active: "Target.md",
		selections: ["7:2"],
		notices: [],
		clipboard: SENTINEL,
	}],

	["a cursor marker at the bottom of the active note, without focus", async (a) => {
		a.open(await note(a), { line: 3, ch: 2 });
		a.choice.captureToActiveFile = true;
		a.choice.activeFileWritePosition = "bottom";
		a.choice.fileOpening = { ...a.choice.fileOpening, focus: false };
		a.choice.format.format = "- {{CURSOR}}NEW";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- NEW",
		},
		active: "Target.md",
		selections: ["7:2"],
		notices: [],
		clipboard: SENTINEL,
	}],
	// Canvas cards.
	["bottom of a Canvas text card", async (a) => {
		a.choice.captureTo = await a.file("Board.canvas", canvasJson([{ id: "card", type: "text", text: CARD }]));
		a.choice.captureToCanvasNodeId = "card";
		a.choice.prepend = true;
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Board.canvas" },
		files: {
			"Origin.md": "origin line\n",
			"Board.canvas": "{\n\t\"nodes\": [\n\t\t{\n\t\t\t\"x\": 0,\n\t\t\t\"y\": 0,\n\t\t\t\"width\": 300,\n\t\t\t\"height\": 200,\n\t\t\t\"id\": \"card\",\n\t\t\t\"type\": \"text\",\n\t\t\t\"text\": \"## Log\\n- one\\n- NEW\"\n\t\t}\n\t],\n\t\"edges\": []\n}",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["after a heading in a Canvas text card", async (a) => {
		a.choice.captureTo = await a.file("Board.canvas", canvasJson([{ id: "card", type: "text", text: CARD }]));
		a.choice.captureToCanvasNodeId = "card";
		Object.assign(a.choice.insertAfter, { enabled: true, after: "## Log", insertAtEnd: false });
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Board.canvas" },
		files: {
			"Origin.md": "origin line\n",
			"Board.canvas": "{\n\t\"nodes\": [\n\t\t{\n\t\t\t\"x\": 0,\n\t\t\t\"y\": 0,\n\t\t\t\"width\": 300,\n\t\t\t\"height\": 200,\n\t\t\t\"id\": \"card\",\n\t\t\t\"type\": \"text\",\n\t\t\t\"text\": \"## Log\\n- NEW\\n- one\"\n\t\t}\n\t],\n\t\"edges\": []\n}",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a Canvas text card, opening the canvas", async (a) => {
		a.choice.captureTo = await a.file("Board.canvas", canvasJson([{ id: "card", type: "text", text: CARD }]));
		a.choice.captureToCanvasNodeId = "card";
		a.choice.prepend = true;
		a.choice.openFile = true;
		a.choice.copyLinkToClipboard = true;
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Board.canvas" },
		files: {
			"Origin.md": "origin line\n",
			"Board.canvas": "{\n\t\"nodes\": [\n\t\t{\n\t\t\t\"x\": 0,\n\t\t\t\"y\": 0,\n\t\t\t\"width\": 300,\n\t\t\t\"height\": 200,\n\t\t\t\"id\": \"card\",\n\t\t\t\"type\": \"text\",\n\t\t\t\"text\": \"## Log\\n- one\\n- NEW\"\n\t\t}\n\t],\n\t\"edges\": []\n}",
		},
		active: "Board.canvas",
		selections: null,
		notices: ["Copied link to 'Board' to clipboard."],
		clipboard: "[[Board.canvas]]",
	}],
	["a Canvas text card, creating a missing heading at the cursor", async (a) => {
		a.choice.captureTo = await a.file("Board.canvas", canvasJson([{ id: "card", type: "text", text: CARD }]));
		a.choice.captureToCanvasNodeId = "card";
		Object.assign(a.choice.insertAfter, { enabled: true, after: "## Missing", createIfNotFound: true, createIfNotFoundLocation: "cursor" });
	}, {
		result: { ok: false, aborted: true, error: "Canvas text cards do not support creating missing line targets at cursor. Use top or bottom." },
		files: {
			"Origin.md": "origin line\n",
			"Board.canvas": "{\"nodes\":[{\"x\":0,\"y\":0,\"width\":300,\"height\":200,\"id\":\"card\",\"type\":\"text\",\"text\":\"## Log\\n- one\"}],\"edges\":[]}",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Capture execution aborted: Canvas text cards do not support creating missing line targets at cursor. Use top or bottom."],
		clipboard: SENTINEL,
	}],
	["a Canvas file card", async (a) => {
		const target = await a.file("Card note.md", NOTE);
		a.choice.captureTo = await a.file("Board.canvas", canvasJson([{ id: "card", type: "file", file: target }]));
		a.choice.captureToCanvasNodeId = "card";
		a.choice.prepend = true;
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Card note.md" },
		files: {
			"Origin.md": "origin line\n",
			"Card note.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- NEW",
			"Board.canvas": "{\"nodes\":[{\"x\":0,\"y\":0,\"width\":300,\"height\":200,\"id\":\"card\",\"type\":\"file\",\"file\":\"Card note.md\"}],\"edges\":[]}",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a Canvas file card, creating a missing heading at the cursor", async (a) => {
		const target = await a.file("Card note.md", NOTE);
		a.choice.captureTo = await a.file("Board.canvas", canvasJson([{ id: "card", type: "file", file: target }]));
		a.choice.captureToCanvasNodeId = "card";
		Object.assign(a.choice.insertAfter, { enabled: true, after: "## Missing", createIfNotFound: true, createIfNotFoundLocation: "cursor" });
	}, {
		result: { ok: false, aborted: true, error: "Canvas file cards do not support creating missing line targets at cursor. Use top or bottom." },
		files: {
			"Origin.md": "origin line\n",
			"Card note.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n",
			"Board.canvas": "{\"nodes\":[{\"x\":0,\"y\":0,\"width\":300,\"height\":200,\"id\":\"card\",\"type\":\"file\",\"file\":\"Card note.md\"}],\"edges\":[]}",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Capture execution aborted: Canvas file cards do not support creating missing line targets at cursor. Use top or bottom."],
		clipboard: SENTINEL,
	}],
	["a canvas without a card id", async (a) => {
		a.choice.captureTo = await a.file("Board.canvas", canvasJson([{ id: "card", type: "text", text: CARD }]));
	}, {
		result: { ok: false, aborted: true, error: "Capture to a .canvas file requires a target canvas node id." },
		files: {
			"Origin.md": "origin line\n",
			"Board.canvas": "{\"nodes\":[{\"x\":0,\"y\":0,\"width\":300,\"height\":200,\"id\":\"card\",\"type\":\"text\",\"text\":\"## Log\\n- one\"}],\"edges\":[]}",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Capture execution aborted: Capture to a .canvas file requires a target canvas node id."],
		clipboard: SENTINEL,
	}],
	["the selected text card of the active canvas", async (a) => {
		const board = await a.file("Board.canvas", canvasJson([{ id: "card", type: "text", text: CARD }]));
		a.open(board);
		a.choice.captureToActiveFile = true;
		a.choice.activeFileWritePosition = "bottom";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Board.canvas" },
		files: {
			"Origin.md": "origin line\n",
			"Board.canvas": "{\n\t\"nodes\":[\n\t\t{\"id\":\"card\",\"type\":\"text\",\"text\":\"## Log\\n- one\\n- NEW\",\"x\":0,\"y\":0,\"width\":300,\"height\":200}\n\t],\n\t\"edges\":[]\n}",
		},
		active: "Board.canvas",
		selections: null,
		notices: [],
		clipboard: SENTINEL,
	}],
	["the selected file card of the active canvas", async (a) => {
		const target = await a.file("Card note.md", NOTE);
		const board = await a.file("Board.canvas", canvasJson([{ id: "card", type: "file", file: target }]));
		a.open(board);
		a.choice.captureToActiveFile = true;
		a.choice.activeFileWritePosition = "bottom";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Card note.md" },
		files: {
			"Origin.md": "origin line\n",
			"Card note.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- NEW",
			"Board.canvas": "{\"nodes\":[{\"x\":0,\"y\":0,\"width\":300,\"height\":200,\"id\":\"card\",\"type\":\"file\",\"file\":\"Card note.md\"}],\"edges\":[]}",
		},
		active: "Card note.md",
		selections: null,
		notices: [],
		clipboard: SENTINEL,
	}],

	["the selected text card of the active canvas, linking to the active note", async (a) => {
		const board = await a.file("Board.canvas", canvasJson([{ id: "card", type: "text", text: CARD }]));
		a.open(board);
		a.choice.captureToActiveFile = true;
		a.choice.activeFileWritePosition = "bottom";
		a.choice.appendLink = true;
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Board.canvas" },
		files: {
			"Origin.md": "origin line\n",
			"Board.canvas": "{\n\t\"nodes\":[\n\t\t{\"id\":\"card\",\"type\":\"text\",\"text\":\"## Log\\n- one\\n- NEW\",\"x\":0,\"y\":0,\"width\":300,\"height\":200}\n\t],\n\t\"edges\":[]\n}",
		},
		active: "Board.canvas",
		selections: null,
		notices: [
			"Canvas capture skipped link insertion because no Markdown editor is focused.",
		],
		clipboard: SENTINEL,
	}],
	// Property capture.
	["setting a property", async (a) => {
		await note(a);
		a.choice.propertyCapture = { property: { kind: "named", format: "status" }, action: "set", createIfMissing: true };
		a.choice.format.format = "{{VALUE}}";
		a.vars.value = "done";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "---\nstatus: done\n---\n# Title\n\n## Log\n- one\n\n## Next\n- two\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["adding to a list property", async (a) => {
		a.choice.captureTo = await a.file("Target.md", "---\ntags:\n  - a\n---\nbody\n");
		a.choice.propertyCapture = { property: { kind: "named", format: "tags" }, action: "addToList", createIfMissing: true };
		a.choice.format.format = "b";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "---\ntags:\n  - a\n  - b\n---\nbody\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a property on a new note", async (a) => {
		a.choice.captureTo = a.path("Created.md");
		a.choice.createFileIfItDoesntExist.enabled = true;
		a.choice.propertyCapture = { property: { kind: "named", format: "status" }, action: "set", createIfMissing: true };
		a.choice.format.format = "open";
	}, {
		result: { ok: true, verified: true, effect: "created", file: "Created.md" },
		files: {
			"Origin.md": "origin line\n",
			"Created.md": "---\nstatus: open\n---\n",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["a property on a missing note without creation", async (a) => {
		a.choice.captureTo = a.path("Missing.md");
		a.choice.propertyCapture = { property: { kind: "named", format: "status" }, action: "set", createIfMissing: true };
		a.choice.format.format = "open";
	}, {
		result: { ok: false, aborted: true, error: "Target file missing: Missing.md. Enable \"Create file if it doesn't exist\" or choose an existing file." },
		files: {
			"Origin.md": "origin line\n",
			"Missing.md": null,
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Capture execution aborted: Target file missing: Missing.md. Enable \"Create file if it doesn't exist\" or choose an existing file."],
		clipboard: SENTINEL,
	}],
	["a property on a Canvas text card", async (a) => {
		a.choice.captureTo = await a.file("Board.canvas", canvasJson([{ id: "card", type: "text", text: CARD }]));
		a.choice.captureToCanvasNodeId = "card";
		a.choice.propertyCapture = { property: { kind: "named", format: "status" }, action: "set", createIfMissing: true };
		a.choice.format.format = "open";
	}, {
		result: { ok: false, aborted: true, error: "Property capture requires a Markdown note. Canvas text cards do not have note properties." },
		files: {
			"Origin.md": "origin line\n",
			"Board.canvas": "{\"nodes\":[{\"x\":0,\"y\":0,\"width\":300,\"height\":200,\"id\":\"card\",\"type\":\"text\",\"text\":\"## Log\\n- one\"}],\"edges\":[]}",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: ["Capture execution aborted: Property capture requires a Markdown note. Canvas text cards do not have note properties."],
		clipboard: SENTINEL,
	}],
];

const TEMPLATER_CASES: Case[] = [
	["a new note whose capture is only a marker once Templater runs", async (a) => {
		a.choice.captureTo = a.path("Created.md");
		a.choice.createFileIfItDoesntExist.enabled = true;
		a.choice.format.format = '<% "" %>{{CURSOR}}';
	}, {
		result: { ok: true, verified: true, effect: "created", file: "Created.md" },
		files: {
			"Origin.md": "origin line\n",
			"Created.md": "",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [],
		clipboard: SENTINEL,
	}],
	["Templater over the whole note after the capture", async (a) => {
		await note(a);
		a.choice.prepend = true;
		a.choice.templater = { afterCapture: "wholeFile" };
		a.choice.format.format = "- <% 1 + 1 %>";
	}, {
		result: { ok: true, verified: true, effect: "changed", file: "Target.md" },
		files: {
			"Origin.md": "origin line\n",
			"Target.md": "# Title\n\n## Log\n- one\n\n## Next\n- two\n- 2",
		},
		active: "Origin.md",
		selections: ["0:0"],
		notices: [
			"QuickAdd: (WARNING) 'Characterization' uses \"Run Templater on entire destination file after capture\", which is deprecated and will be removed in a future release. QuickAdd already runs Templater in what it captures. Turn the option off in the Capture's settings.",
		],
		clipboard: SENTINEL,
	}],
];

const check = (mode: Mode) => async (_name: string, arrange: Case[1], expected: Observation) => {
	const observe = await arrangeAndRun(arrange, mode);
	await expect.poll(observe, { timeout: 5_000, interval: 250 }).toEqual(expected);
};

describe.each(MODES)("Capture run characterization (%s)", (_mode, mode) => {
	it.each(CASES)("%s", check(mode));
});

describe.runIf(process.env.OBSIDIAN_E2E_TEMPLATER === "1").each(MODES)("Capture run characterization with Templater (%s)", (_mode, mode) => {
	beforeAll(async () => {
		expect(await getContext().obsidian.dev.evalJson(
			`Boolean(app.plugins.plugins["templater-obsidian"]?.templater)`,
		)).toBe(true);
	});

	it.each(TEMPLATER_CASES)("%s", check(mode));
});
