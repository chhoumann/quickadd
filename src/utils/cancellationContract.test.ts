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
 * Comments talk ABOUT the shapes below ("would throw \"Unknown location\""), so scanning
 * raw text produces false positives. Blank them, preserving offsets so reported line
 * numbers still point at the real line.
 */
function stripComments(text: string): string {
	return text
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/(^|[^:])\/\/[^\n]*/g, (m, lead: string) => lead + " ".repeat(m.length - lead.length));
}

/**
 * Any `reject(...)` / `rejectPromise(...)` CALL, capturing its argument up to the first
 * `)`. Matching the call rather than a bare-string argument is deliberate: the shape that
 * would actually reintroduce #1577 is not only `reject("dismissed")` but also
 * `reject(new Error("dismissed"))` - an Error `isCancellationError` cannot recognise,
 * so a dismissal reads as a failure again with nothing to catch it.
 *
 * `[\s\S]` rather than `[^\n]`: an argument split across lines would otherwise capture
 * as empty and be waved through as an executor binding.
 */
const REJECT_CALL = /\b(?:reject|rejectPromise)(?:!|\?\.|\?)?\s*\(\s*([\s\S]*?)\)/g;
/** A `throw` of a string literal, i.e. a bare-string rejection inside an async method. */
const THROW_STRING = /\bthrow\s+["'`]/g;

/** Directories whose modules are prompt surfaces: a rejection there means a dismissal. */
const PROMPT_DIRS = [join(SRC, "gui"), join(SRC, "preflight")];

/**
 * Every rejection in `text` that is not `promptCancelled()`, as `line — snippet`.
 * Extracted from the directory scan so the detector itself is testable: this guard is
 * load-bearing, and a guard that silently stops matching is worse than none.
 */
export function findNonCancelledRejections(text: string): string[] {
	const found: string[] = [];
	const stripped = stripComments(text);
	for (const match of stripped.matchAll(REJECT_CALL)) {
		const arg = (match[1] ?? "").trim();
		// `new Promise((resolve, reject) => …)`: the binding, not a call on it.
		if (arg === "" || arg.startsWith("=>")) continue;
		if (arg.startsWith("promptCancelled(")) continue;
		const line = stripped.slice(0, match.index).split("\n").length;
		found.push(`${line} — ${match[0].trim().replace(/\s+/g, " ").slice(0, 60)}`);
	}
	return found;
}

describe("cancellation contract (#1577)", () => {
	// The positive invariant, not a negative syntax shape: inside the prompt
	// surfaces, the ONLY thing a promise may be rejected with is promptCancelled().
	it("every prompt rejection is promptCancelled()", () => {
		const offenders: string[] = [];
		for (const dir of PROMPT_DIRS) {
			for (const file of walk(dir)) {
				for (const hit of findNonCancelledRejections(readFileSync(file, "utf8"))) {
					offenders.push(`${file.slice(SRC.length + 1)}:${hit}`);
				}
			}
		}
		expect(
			offenders,
			"A dismissed prompt must reject with promptCancelled(). A bare string is " +
				"unrecognisable and untraceable; a plain Error reads as a genuine failure.",
		).toEqual([]);
	});

	it("no source file throws a bare string literal", () => {
		const offenders: string[] = [];
		for (const file of walk(SRC)) {
			const text = stripComments(readFileSync(file, "utf8"));
			for (const match of text.matchAll(THROW_STRING)) {
				const line = text.slice(0, match.index).split("\n").length;
				offenders.push(`${file.slice(SRC.length + 1)}:${line} — ${match[0].trim()}…`);
			}
		}
		expect(
			offenders,
			"Throw an Error so the value carries a stack and can be classified.",
		).toEqual([]);
	});

	it("no source file re-introduces a legacy cancellation sentinel", () => {
		// Unquoted so single-quoted and template forms count too. OnePageInputModal's
		// old sentinel, "cancelled", is deliberately absent: as a bare substring it is
		// far too common a word in src/ to scan for. The reject-call invariant above is
		// what actually guards that modal.
		const sentinels = ["No input given.", "no input given."];
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

	// Guards the guard: these are the shapes that would reintroduce #1577, and a
	// detector that stops seeing one of them fails silently.
	describe("the rejection detector", () => {
		it.each([
			["a bare string", 'this.rejectPromise("dismissed");'],
			["an unrecognisable Error", 'this.rejectPromise(new Error("dismissed"));'],
			["an indirected constant", "this.rejectPromise(CANCEL_MESSAGE);"],
			["an optional call", 'this.rejectPromise?.("dismissed");'],
			["the raw reject binding", 'reject("dismissed");'],
			// The multiline forms: captured as EMPTY by a line-bounded pattern, which
			// would then wave them through as an executor binding.
			["a multiline string", 'this.rejectPromise(\n\t"dismissed",\n);'],
			[
				"a multiline Error",
				'this.rejectPromise(\n\tnew Error("dismissed"),\n);',
			],
		])("flags %s", (_label, source) => {
			expect(findNonCancelledRejections(source)).not.toEqual([]);
		});

		it.each([
			["the contract", "this.rejectPromise(promptCancelled());"],
			["the contract, multiline", "this.rejectPromise(\n\tpromptCancelled(),\n);"],
			[
				"an executor binding",
				"this.waitForClose = new Promise((resolve, reject) => {\n\t\tthis.rejectPromise = reject;\n\t});",
			],
			[
				"a comment about the old shape",
				'// this.rejectPromise("dismissed") - the pre-#1577 shape',
			],
		])("allows %s", (_label, source) => {
			expect(findNonCancelledRejections(source)).toEqual([]);
		});
	});

	// If the walk stops finding files (a moved directory, a changed extension filter),
	// every scan above passes vacuously.
	it("the scan actually reads the prompt sources", () => {
		const scanned = PROMPT_DIRS.flatMap((dir) => walk(dir));
		expect(scanned.length).toBeGreaterThan(50);
		expect(
			scanned.some((f) => f.endsWith(join("GenericSuggester", "genericSuggester.ts"))),
		).toBe(true);
		expect(
			scanned.some((f) => f.endsWith(join("preflight", "OnePageInputModal.ts"))),
		).toBe(true);
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
