import { describe, it, expect } from "vitest";
import type { TAbstractFile } from "obsidian";
import {
	resolveCaptureTarget,
	type CaptureTargetDeps,
} from "./captureTargetResolution";
import { ChoiceAbortError } from "../../errors/ChoiceAbortError";

function deps(opts: { isFolder?: boolean; fileExists?: boolean } = {}): CaptureTargetDeps {
	return {
		getAbstractFileByPath: () =>
			opts.fileExists ? ({} as TAbstractFile) : null,
		isFolder: () => !!opts.isFolder,
		// Faithful to QuickAddEngine.normalizeMarkdownFilePath for the ""+folderPath call.
		normalizeMarkdownFilePath: (folderPath, fileName) => {
			const safe = folderPath.replace(/^\/+/, "");
			const prefix = safe ? `${safe}/` : "";
			const name = fileName.replace(/^\/+/, "").replace(/\.md$/i, "");
			return `${prefix}${name}.md`;
		},
	};
}

describe("resolveCaptureTarget", () => {
	it("routes empty input to the vault-wide picker", () => {
		expect(resolveCaptureTarget("", deps())).toEqual({ kind: "vault" });
		expect(resolveCaptureTarget("   ", deps())).toEqual({ kind: "vault" });
		expect(resolveCaptureTarget("/", deps())).toEqual({ kind: "vault" });
	});

	it("routes an explicit trailing slash to a folder picker", () => {
		expect(resolveCaptureTarget("journals/", deps())).toEqual({
			kind: "folder",
			folder: "journals",
		});
	});

	it("routes a known markdown/canvas extension to a file", () => {
		expect(resolveCaptureTarget("Inbox/note.md", deps())).toEqual({
			kind: "file",
			path: "Inbox/note.md",
		});
		expect(resolveCaptureTarget("Boards/board.canvas", deps())).toEqual({
			kind: "file",
			path: "Boards/board.canvas",
		});
	});

	it("treats an ambiguous name as a folder only when the folder exists and no same-name file does", () => {
		expect(
			resolveCaptureTarget("journals", deps({ isFolder: true, fileExists: false })),
		).toEqual({ kind: "folder", folder: "journals" });
		// folder exists but a same-name note also exists -> file wins (disambiguation)
		expect(
			resolveCaptureTarget("journals", deps({ isFolder: true, fileExists: true })),
		).toEqual({ kind: "file", path: "journals" });
		// not a folder at all -> file
		expect(
			resolveCaptureTarget("journals", deps({ isFolder: false })),
		).toEqual({ kind: "file", path: "journals" });
	});

	it("routes property:<field>[=<value>] to the property picker before any file/folder branch", () => {
		const r = resolveCaptureTarget("property:type=draft", deps());
		expect(r.kind).toBe("property");
		if (r.kind === "property") {
			expect(r.field).toBe("type");
			expect(r.value).toBe("draft");
		}
	});

	it("does not misroute a property value that looks like a file path", () => {
		const r = resolveCaptureTarget("property:type=draft.md", deps());
		expect(r.kind).toBe("property");
		if (r.kind === "property") expect(r.value).toBe("draft.md");
	});

	it("throws when a property target has no field name", () => {
		expect(() => resolveCaptureTarget("property:=x", deps())).toThrow(
			ChoiceAbortError,
		);
	});

	it("routes tag/folder filters to the filtered picker", () => {
		expect(resolveCaptureTarget("#work|tag:project", deps()).kind).toBe(
			"filter",
		);
	});

	it("rejects a multi-select filter as a capture destination", () => {
		expect(() => resolveCaptureTarget("tag:work|multi", deps())).toThrow(
			ChoiceAbortError,
		);
	});

	it("rejects .base file targets", () => {
		expect(() => resolveCaptureTarget("Data/table.base", deps())).toThrow(
			ChoiceAbortError,
		);
	});
});
