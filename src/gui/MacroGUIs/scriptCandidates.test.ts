import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import {
	type ScriptCandidate,
	noteScriptError,
	resolveScriptSelector,
} from "./scriptCandidates";

function file(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split("/").pop() ?? path;
	f.extension = path.split(".").pop() ?? "";
	f.basename = f.name.replace(/\.[^.]+$/, "");
	return f;
}

function candidate(path: string, isMarkdown: boolean): ScriptCandidate {
	return { file: file(path), isMarkdown };
}

function appWith(
	files: TFile[],
	contents: Record<string, string> = {},
): App {
	const byPath = new Map(files.map((f) => [f.path, f]));
	return {
		vault: {
			getAbstractFileByPath: vi.fn((p: string) => byPath.get(p) ?? null),
			read: vi.fn(async (f: TFile) => contents[f.path] ?? ""),
		},
	} as unknown as App;
}

describe("resolveScriptSelector", () => {
	it("matches a bare basename to the .js file, never a same-named note (#1065 collision)", () => {
		const candidates = [
			candidate("Notes/foo.md", true),
			candidate("Scripts/foo.js", false),
		];
		// Note appears first in the list; a bare basename must still pick the .js.
		const resolved = resolveScriptSelector(
			appWith(candidates.map((c) => c.file)),
			candidates,
			"foo",
		);
		expect(resolved?.file.path).toBe("Scripts/foo.js");
		expect(resolved?.isMarkdown).toBe(false);
	});

	it("matches a note by its full path", () => {
		const candidates = [
			candidate("Notes/foo.md", true),
			candidate("Scripts/foo.js", false),
		];
		const resolved = resolveScriptSelector(
			appWith(candidates.map((c) => c.file)),
			candidates,
			"Notes/foo.md",
		);
		expect(resolved?.file.path).toBe("Notes/foo.md");
		expect(resolved?.isMarkdown).toBe(true);
	});

	it("falls back to a direct vault lookup when the candidate list is cold", () => {
		const noteFile = file("Notes/fresh.md");
		const resolved = resolveScriptSelector(
			appWith([noteFile]),
			[], // pre-filter hasn't indexed it yet
			"Notes/fresh.md",
		);
		expect(resolved?.file.path).toBe("Notes/fresh.md");
		expect(resolved?.isMarkdown).toBe(true);
	});

	it("returns null for a non-script file or a missing path", () => {
		const app = appWith([file("Notes/plain.txt")]);
		expect(resolveScriptSelector(app, [], "Notes/plain.txt")).toBeNull();
		expect(resolveScriptSelector(app, [], "does/not/exist.md")).toBeNull();
	});
});

describe("noteScriptError", () => {
	it("returns null for a note with a runnable js fence", async () => {
		const f = file("Notes/ok.md");
		const app = appWith([f], {
			"Notes/ok.md": "intro\n\n```js\nmodule.exports = () => 1;\n```",
		});
		expect(await noteScriptError(app, f)).toBeNull();
	});

	it("returns a no-fence reason for a note without a js block", async () => {
		const f = file("Notes/none.md");
		const app = appWith([f], { "Notes/none.md": "# just prose" });
		expect(await noteScriptError(app, f)).toMatch(/no .*code block/i);
	});

	it("returns an empty-fence reason for an empty js block", async () => {
		const f = file("Notes/empty.md");
		const app = appWith([f], { "Notes/empty.md": "```js\n\n```" });
		expect(await noteScriptError(app, f)).toMatch(/empty/i);
	});
});
