import { describe, it, expect } from "vitest";
import { sanitizeVaultPath, UnsafeVaultPathError } from "./sanitizeVaultPath";

describe("sanitizeVaultPath", () => {
	describe("accepts safe vault-relative paths", () => {
		it("returns a normalized relative path", () => {
			expect(sanitizeVaultPath("Notes/Foo.md")).toBe("Notes/Foo.md");
			expect(sanitizeVaultPath("  Inbox/today.md  ")).toBe("Inbox/today.md");
			expect(sanitizeVaultPath("a//b///c.md")).toBe("a/b/c.md");
		});

		it("allows dots inside a name (not a leading-dot segment)", () => {
			expect(sanitizeVaultPath("My..Note.md")).toBe("My..Note.md");
			expect(sanitizeVaultPath("v1.2.3 release.md")).toBe("v1.2.3 release.md");
		});
	});

	describe("rejects absolute / drive / UNC paths", () => {
		it("rejects a POSIX absolute path", () => {
			expect(() => sanitizeVaultPath("/etc/passwd")).toThrow(UnsafeVaultPathError);
		});
		it("rejects a Windows drive path", () => {
			expect(() => sanitizeVaultPath("C:\\Windows\\x")).toThrow(UnsafeVaultPathError);
			expect(() => sanitizeVaultPath("C:foo")).toThrow(UnsafeVaultPathError);
		});
		it("rejects a UNC path (backslashes normalized to // before the absolute check)", () => {
			expect(() => sanitizeVaultPath("\\\\server\\share\\x.md")).toThrow(
				UnsafeVaultPathError,
			);
		});
	});

	describe("rejects traversal", () => {
		it("rejects a .. segment anywhere", () => {
			expect(() => sanitizeVaultPath("a/../b.md")).toThrow(UnsafeVaultPathError);
			expect(() => sanitizeVaultPath("../secrets.md")).toThrow(UnsafeVaultPathError);
		});
	});

	describe("config-dir / dotfile floor — every segment, any depth, case-folded", () => {
		it("rejects a first-segment config dir", () => {
			expect(() => sanitizeVaultPath(".obsidian/plugins/x/main.js")).toThrow(
				UnsafeVaultPathError,
			);
		});
		it("rejects a NESTED config dir at depth >= 2 (the v3 blocker)", () => {
			expect(() => sanitizeVaultPath("Projects/.git/hooks/post-checkout")).toThrow(
				UnsafeVaultPathError,
			);
			expect(() => sanitizeVaultPath("notes/.obsidian/plugins/evil/main.js")).toThrow(
				UnsafeVaultPathError,
			);
		});
		it("is immune to casing (structural, not a name denylist)", () => {
			expect(() => sanitizeVaultPath("x/.Obsidian/y.md")).toThrow(UnsafeVaultPathError);
			expect(() => sanitizeVaultPath(".GIT/config")).toThrow(UnsafeVaultPathError);
		});
		it("rejects a leading-dot basename too", () => {
			expect(() => sanitizeVaultPath("Notes/.env")).toThrow(UnsafeVaultPathError);
		});
	});

	describe("character + device-name validation", () => {
		it("rejects illegal characters", () => {
			expect(() => sanitizeVaultPath("Notes/a:b.md")).toThrow(UnsafeVaultPathError);
			expect(() => sanitizeVaultPath("Notes/a*b.md")).toThrow(UnsafeVaultPathError);
		});
		it("rejects a trailing dot/space segment", () => {
			expect(() => sanitizeVaultPath("Notes/folder./bar.md")).toThrow(
				UnsafeVaultPathError,
			);
			expect(() => sanitizeVaultPath("Notes/trailing space /bar.md")).toThrow(
				UnsafeVaultPathError,
			);
		});
		it("rejects reserved Windows device names", () => {
			expect(() => sanitizeVaultPath("CON/x.md")).toThrow(UnsafeVaultPathError);
			expect(() => sanitizeVaultPath("Notes/NUL.md")).toThrow(UnsafeVaultPathError);
		});
		it("still derives the device-name base from the first dot", () => {
			// NUL.tar.gz → base "NUL" must still be rejected now that the
			// (provably no-op) trailing-dot/space replace is gone.
			expect(() => sanitizeVaultPath("Notes/NUL.tar.gz")).toThrow(
				UnsafeVaultPathError,
			);
		});
		// The basename extraction used `.replace(/[. ]+$/u, "")` - a guaranteed
		// no-op (the trailing-char guard above already rejected such segments)
		// that still backtracked quadratically on a long interior dot run:
		// ~2.8s at 80k chars, reachable from the auto-run (no-approval) read
		// tools with a model-chosen path. This pins linear behavior; the budget
		// is generous to stay non-flaky while failing hard on any regression.
		it("validates a segment with a long interior dot run in linear time", () => {
			const path = "a" + ".".repeat(200_000) + "b";
			const start = performance.now();
			expect(sanitizeVaultPath(path)).toBe(path);
			expect(performance.now() - start).toBeLessThan(1000);
		}, 20_000);
		it("rejects empty input", () => {
			expect(() => sanitizeVaultPath("   ")).toThrow(UnsafeVaultPathError);
			expect(() => sanitizeVaultPath("///")).toThrow(UnsafeVaultPathError);
		});
	});

	describe("allowedRoots scoping", () => {
		it("allows a path under an allowed root", () => {
			expect(sanitizeVaultPath("AI/notes/x.md", { allowedRoots: ["AI"] })).toBe(
				"AI/notes/x.md",
			);
			expect(sanitizeVaultPath("AI", { allowedRoots: ["AI"] })).toBe("AI");
		});
		it("rejects a path outside the allowed roots", () => {
			expect(() =>
				sanitizeVaultPath("Other/x.md", { allowedRoots: ["AI"] }),
			).toThrow(UnsafeVaultPathError);
		});
		it("does not let a leading slash sneak a path past allowedRoots", () => {
			// "/AI/x.md" is rejected as absolute before any root check.
			expect(() =>
				sanitizeVaultPath("/AI/x.md", { allowedRoots: ["AI"] }),
			).toThrow(UnsafeVaultPathError);
		});
		it("an empty-string root never becomes allow-all", () => {
			// A blank entry is dropped; with no real roots left, it falls back to the
			// vault-wide default (allow), NOT allow-all-by-accident-because-of-blank.
			expect(sanitizeVaultPath("Anywhere/x.md", { allowedRoots: ["", "  "] })).toBe(
				"Anywhere/x.md",
			);
			// But a blank entry alongside a real root must NOT widen it to allow-all.
			expect(() =>
				sanitizeVaultPath("Other/x.md", { allowedRoots: ["", "AI"] }),
			).toThrow(UnsafeVaultPathError);
		});
	});
});
