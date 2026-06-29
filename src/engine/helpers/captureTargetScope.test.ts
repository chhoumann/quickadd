import { describe, expect, it } from "vitest";
import { classifyCaptureTargetScope } from "./captureTargetScope";

const noFolders = { isFolder: () => false };
const withFolders = (folders: string[]) => ({
	isFolder: (path: string) => folders.includes(path),
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

	it("returns null for a tokenized file path (resolved only at run time)", () => {
		expect(
			classifyCaptureTargetScope(noFolders, "Projects/{{VALUE}}.md", false),
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
