import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Byte-level hygiene guard for #1619.
 *
 * A single raw NUL byte in packageImportService.ts made ripgrep classify the
 * whole 1000+-line service as a binary file and silently skip it on every
 * default recursive search - `git grep` and `git diff` were unaffected, so the
 * blind spot never showed up in review. A second raw NUL had already crept into
 * modelSyncService.ts the same way. Both are now written as escape sequences;
 * this test is what keeps the class of bug from coming back.
 *
 * Tab, LF and CR are the only control bytes a text source file legitimately
 * contains. Everything else (NUL, vertical tab, form feed, ESC, DEL, ...) either
 * flips grep tools into binary mode or is an accident - a string that needs such
 * a byte at runtime writes it as an escape sequence.
 */

const SRC = resolve(__dirname);
const EXTS = [".ts", ".tsx", ".svelte", ".js", ".mjs"];

const ALLOWED_CONTROL_BYTES = new Set([0x09, 0x0a, 0x0d]); // \t \n \r

function walk(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) walk(p, acc);
		else if (EXTS.includes(extname(entry.name))) acc.push(p);
	}
	return acc;
}

function findForbiddenBytes(
	buffer: Buffer,
): { byte: number; line: number }[] {
	const hits: { byte: number; line: number }[] = [];
	let line = 1;
	for (const byte of buffer) {
		if (byte === 0x0a) line++;
		if (
			(byte < 0x20 && !ALLOWED_CONTROL_BYTES.has(byte)) ||
			byte === 0x7f
		) {
			hits.push({ byte, line });
		}
	}
	return hits;
}

describe("source files contain no raw control bytes (#1619)", () => {
	it("every src file is grep-safe plain text", () => {
		const offenders: string[] = [];
		for (const file of walk(SRC)) {
			const hits = findForbiddenBytes(readFileSync(file));
			for (const { byte, line } of hits) {
				offenders.push(
					`${relative(SRC, file)}:${line} contains raw byte 0x${byte
						.toString(16)
						.padStart(2, "0")} - write it as an escape sequence (e.g. \\u0000) instead`,
				);
			}
		}
		expect(offenders).toEqual([]);
	});
});
