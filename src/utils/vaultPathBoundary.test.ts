import { describe, expect, it } from "vitest";
import { escapesVaultBoundary } from "./vaultPathBoundary";

describe("escapesVaultBoundary", () => {
	it("rejects POSIX-absolute paths", () => {
		expect(escapesVaultBoundary("/etc/passwd")).toBe(true);
		expect(escapesVaultBoundary("/")).toBe(true);
	});

	it("rejects Windows drive and drive-relative paths", () => {
		expect(escapesVaultBoundary("C:\\Windows\\System32\\x")).toBe(true);
		expect(escapesVaultBoundary("C:/Windows/x")).toBe(true);
		expect(escapesVaultBoundary("C:foo")).toBe(true);
	});

	it("rejects backslash-normalized UNC paths", () => {
		expect(escapesVaultBoundary("\\\\server\\share\\x")).toBe(true);
	});

	it("rejects '..' traversal at any depth and with any separator", () => {
		expect(escapesVaultBoundary("../escape.md")).toBe(true);
		expect(escapesVaultBoundary("../../../etc/passwd")).toBe(true);
		expect(escapesVaultBoundary("notes/../../escape.md")).toBe(true);
		expect(escapesVaultBoundary("..\\..\\escape.md")).toBe(true);
	});

	it("allows in-vault relative paths, including dot/config dirs", () => {
		expect(escapesVaultBoundary("templates/note.md")).toBe(false);
		expect(escapesVaultBoundary("scripts/run.js")).toBe(false);
		// Probing an in-vault config-dir file is in-bounds; only the WRITE path
		// forbids dropping INTO config dirs.
		expect(escapesVaultBoundary(".obsidian/plugins/x/script.js")).toBe(false);
		expect(escapesVaultBoundary("notes/.git/HEAD")).toBe(false);
	});

	it("treats url-encoded traversal text as a benign literal segment", () => {
		// "%2f" is never decoded into a slash, so this is one literal filename
		// inside the vault — not a traversal.
		expect(escapesVaultBoundary("..%2fevil.md")).toBe(false);
	});

	it("does not treat an empty path as an escape", () => {
		expect(escapesVaultBoundary("")).toBe(false);
		expect(escapesVaultBoundary("   ")).toBe(false);
	});
});
