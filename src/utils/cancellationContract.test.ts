import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { isCancellationError } from "./errorUtils";
import {
	PROMPT_CANCELLED_MESSAGE,
	UserCancelError,
	promptCancelled,
} from "../errors/UserCancelError";
import { MacroAbortError } from "../errors/MacroAbortError";

/**
 * The cancellation contract (#1577): a dismissed prompt throws a typed
 * `UserCancelError`, never a bare English sentence. The string list in
 * `isCancellationError` exists only for user scripts that still throw a legacy
 * sentinel - if QuickAdd's own code starts producing one again, the fragility the
 * types removed is back, and the compiler will not say a word. Hence the ratchet.
 */

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			walk(full, out);
			continue;
		}
		if (!/\.(ts|svelte)$/.test(entry)) continue;
		if (/\.test\.ts$/.test(entry)) continue;
		out.push(full);
	}
	return out;
}

/**
 * A reject/throw whose argument is a bare string literal. Deliberately narrow:
 * it catches the exact shape every prompt used before #1577 and would use again
 * by copy-paste, without flagging `new Error("...")`.
 */
const BARE_STRING_REJECTION =
	/\b(?:reject|rejectPromise|rejectPromise!)\s*\(\s*(["'`])/g;

describe("cancellation contract (#1577)", () => {
	it("no source file rejects a promise with a bare string literal", () => {
		const offenders: string[] = [];
		for (const file of walk(SRC)) {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(BARE_STRING_REJECTION)) {
				const line = text.slice(0, match.index).split("\n").length;
				offenders.push(
					`${file.slice(SRC.length + 1)}:${line} — ${match[0].trim()}…`,
				);
			}
		}
		expect(
			offenders,
			"A dismissed prompt must reject with promptCancelled(), not a string. " +
				"For a genuine failure, reject with an Error so it carries a stack.",
		).toEqual([]);
	});

	it("no source file re-introduces a legacy cancellation sentinel", () => {
		const sentinels = ['"No input given."', '"no input given."'];
		const offenders: string[] = [];
		for (const file of walk(SRC)) {
			// errorUtils owns the compatibility list by design.
			if (file.endsWith(join("utils", "errorUtils.ts"))) continue;
			const text = readFileSync(file, "utf8");
			for (const sentinel of sentinels) {
				if (text.includes(sentinel)) {
					offenders.push(`${file.slice(SRC.length + 1)} — ${sentinel}`);
				}
			}
		}
		expect(offenders).toEqual([]);
	});

	it("recognises a typed prompt dismissal", () => {
		expect(isCancellationError(promptCancelled())).toBe(true);
		expect(isCancellationError(new UserCancelError("anything"))).toBe(true);
	});

	it("still recognises the legacy sentinels a user script may throw", () => {
		expect(isCancellationError("No input given.")).toBe(true);
		expect(isCancellationError("no input given.")).toBe(true);
		expect(isCancellationError("cancelled")).toBe(true);
	});

	it("does not mistake a real failure for a cancellation", () => {
		expect(isCancellationError(new Error("ENOENT"))).toBe(false);
		expect(isCancellationError(new MacroAbortError("target missing"))).toBe(
			false,
		);
		expect(isCancellationError("Cancelled")).toBe(false);
		expect(isCancellationError(undefined)).toBe(false);
		expect(isCancellationError(null)).toBe(false);
	});

	it("carries the message the public docs promise", () => {
		const error = promptCancelled();
		// docs/.../QuickAddAPI.md tells scripts to expect
		// MacroAbortError("Input cancelled by user").
		expect(error.message).toBe(PROMPT_CANCELLED_MESSAGE);
		expect(error.message).toBe("Input cancelled by user");
		expect(error.name).toBe("MacroAbortError");
		expect(error).toBeInstanceOf(MacroAbortError);
	});
});
