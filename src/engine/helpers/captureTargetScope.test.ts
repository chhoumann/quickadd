import { describe, expect, it } from "vitest";
import { classifyCaptureTargetScope } from "./captureTargetScope";

const noFolders = { isFolder: () => false, markdownFileExists: () => false };
// `folders` are existing folder paths; `notes` are the bare names whose
// `<name>.md` note exists (what the markdownFileExists probe reports on).
const withFolders = (folders: string[], notes: string[] = []) => ({
	isFolder: (path: string) => folders.includes(path),
	markdownFileExists: (path: string) => notes.includes(path),
});

describe("classifyCaptureTargetScope", () => {
	it("returns null for capture-to-active-file regardless of target", () => {
		expect(classifyCaptureTargetScope(noFolders, "Inbox/", true)).toBeNull();
	});

	it("returns null for a definite file target (no runtime pick needed)", () => {
		expect(classifyCaptureTargetScope(noFolders, "Inbox.md", false)).toBeNull();
		expect(
			classifyCaptureTargetScope(noFolders, "Notes/Daily.md", false),
		).toBeNull();
	});

	it("keeps a definite .md/.canvas target definite even when a same-named folder exists", () => {
		// resolveCaptureTarget tests the file extension BEFORE the folder-ambiguity
		// check, so `X.md` is a definite file regardless of a colliding folder `X`.
		// The scope classifier must agree, or the engine honours an injected
		// __qa.captureTargetFilePath for a configured definite-file target (#1448).
		expect(
			classifyCaptureTargetScope(withFolders(["Inbox"]), "Inbox.md", false),
		).toBeNull();
		expect(
			classifyCaptureTargetScope(
				withFolders(["Notes/Daily"]),
				"Notes/Daily.md",
				false,
			),
		).toBeNull();
		expect(
			classifyCaptureTargetScope(withFolders(["Board"]), "Board.canvas", false),
		).toBeNull();
		// Leading slash / surrounding whitespace must not let the collision back in.
		expect(
			classifyCaptureTargetScope(withFolders(["Inbox"]), "  /Inbox.md  ", false),
		).toBeNull();
	});

	it("returns null for an unsupported .base target even when a same-named folder exists", () => {
		// resolveCaptureTarget throws on `.base` BEFORE the folder-ambiguity check,
		// so a `.base` target is never a runtime-pick scope. Returning null keeps the
		// engine from honouring an injected pick for it (it falls through to the
		// resolver's unsupported-target abort) and matches the extension-first order.
		expect(
			classifyCaptureTargetScope(
				withFolders(["Archive.base"]),
				"Archive.base",
				false,
			),
		).toBeNull();
	});

	it("treats a bare name as a definite file when a same-named note also exists", () => {
		// resolveCaptureTarget disambiguates a folder/file collision in the file's
		// favour (docs: "if both Projects/ and Projects.md exist, Projects targets
		// Projects.md"). The classifier must agree so it neither prompts nor honours
		// an injected pick for a bare name the write path resolves to a definite file.
		expect(
			classifyCaptureTargetScope(
				withFolders(["Projects"], ["Projects"]),
				"Projects",
				false,
			),
		).toBeNull();
		// Folder exists but NO same-name note -> still a folder scope.
		expect(
			classifyCaptureTargetScope(withFolders(["Projects"]), "Projects", false),
		).toEqual({ kind: "folder", folderPathSlash: "Projects/" });
		// An explicit trailing slash forces the folder picker even when the note
		// exists (docs: "use Projects/ to force the folder picker").
		expect(
			classifyCaptureTargetScope(
				withFolders(["Projects"], ["Projects"]),
				"Projects/",
				false,
			),
		).toEqual({ kind: "folder", folderPathSlash: "Projects/" });
	});

	it("returns null for a tokenized file path (resolved only at run time)", () => {
		expect(
			classifyCaptureTargetScope(noFolders, "Projects/{{VALUE}}.md", false),
		).toBeNull();
	});

	it("returns null for a tokenized folder-suffix target (resolved at run time)", () => {
		expect(
			classifyCaptureTargetScope(noFolders, "Projects/{{VALUE}}/", false),
		).toBeNull();
		// Even if the literal token folder happens to exist, the token defers it.
		expect(
			classifyCaptureTargetScope(
				withFolders(["Projects/{{VALUE}}"]),
				"Projects/{{VALUE}}/",
				false,
			),
		).toBeNull();
	});

	it("classifies an empty target as the whole-vault folder scope", () => {
		expect(classifyCaptureTargetScope(noFolders, "", false)).toEqual({
			kind: "folder",
			folderPathSlash: "",
		});
		expect(classifyCaptureTargetScope(noFolders, "/", false)).toEqual({
			kind: "folder",
			folderPathSlash: "",
		});
	});

	it("classifies a trailing-slash target as a folder scope", () => {
		expect(classifyCaptureTargetScope(noFolders, "Inbox/", false)).toEqual({
			kind: "folder",
			folderPathSlash: "Inbox/",
		});
	});

	it("classifies a bare existing-folder name as a folder scope", () => {
		expect(
			classifyCaptureTargetScope(withFolders(["Inbox"]), "Inbox", false),
		).toEqual({ kind: "folder", folderPathSlash: "Inbox/" });
	});

	it("classifies a bare name with no matching folder as null (a file)", () => {
		expect(classifyCaptureTargetScope(noFolders, "Inbox", false)).toBeNull();
	});

	it("classifies a property target", () => {
		const scope = classifyCaptureTargetScope(
			noFolders,
			"property:type=draft",
			false,
		);
		expect(scope).toMatchObject({ kind: "property", field: "type", value: "draft" });
	});

	it("classifies a tag/filter target", () => {
		const scope = classifyCaptureTargetScope(noFolders, "tag:work", false);
		expect(scope?.kind).toBe("filter");
	});

	it("returns null for a multi-select filter target (not a single destination)", () => {
		expect(
			classifyCaptureTargetScope(noFolders, "#work|multi", false),
		).toBeNull();
	});

	it("returns null for a property target missing a field name", () => {
		expect(classifyCaptureTargetScope(noFolders, "property:", false)).toBeNull();
	});
});
