import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural regression guard for #1249.
 *
 * The bug was NOT a single bad import — it was a 43-module circular-dependency
 * component (SCC) in which a class `extends` a base that, due to ESM evaluation
 * order, was still `undefined` ("Class extends value undefined"). Crucially, such
 * a cycle can be *benign today yet fatal tomorrow*: whether it throws depends on
 * module entry order, so a behavioural test (mounting ChoiceView) only catches the
 * specific manifestation it happens to trigger. Reverting one half of the fix can
 * leave every behavioural test green while re-arming the landmine.
 *
 * This test encodes the actual invariant the fix established and must preserve:
 *   No `class X extends Y` where Y is a *value* import from a module in the same
 *   strongly-connected component as X.
 *
 * Benign cycles (mutually-recursive functions, recursive Svelte components) are
 * fine and intentionally NOT failed — only cross-cycle class inheritance, the
 * thing that throws at module-eval time, is forbidden.
 */

const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");
const EXTS = [".ts", ".tsx", ".svelte", ".js", ".mjs"];

function walk(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) walk(p, acc);
		else if (
			EXTS.includes(extname(entry.name)) &&
			!/\.(test|spec)\./.test(entry.name) &&
			!entry.name.endsWith(".d.ts")
		) {
			acc.push(p);
		}
	}
	return acc;
}

const files = walk(SRC);
const fileSet = new Set(files);

function resolveSpec(fromFile: string, spec: string): string | null {
	if (!spec.startsWith(".") && !spec.startsWith("src/")) return null; // external pkg
	const base = spec.startsWith("src/")
		? join(ROOT, spec)
		: resolve(dirname(fromFile), spec);
	const candidates = [base];
	for (const ext of EXTS) candidates.push(base + ext);
	for (const ext of EXTS) candidates.push(join(base, `index${ext}`));
	return candidates.find((c) => fileSet.has(c)) ?? null;
}

// Whole-file import scan. `import ... from "x"` (multi-line tolerant) — but NOT
// `await import("x")`, which is lazy and breaks eval-time cycles by design.
const IMPORT_RE = /import\s+(type\s+)?([^;'"]*?)\s+from\s+(['"])([^'"]+)\3/g;
// `class X extends Y` / `export default abstract class X<T> extends Y`.
const EXTENDS_RE =
	/\bclass\s+[A-Za-z_$][\w$]*(?:<[^>]*>)?\s+extends\s+([A-Za-z_$][\w$]*)/g;

interface Edge {
	to: string;
	typeOnly: boolean;
	names: Set<string>;
}

const valueAdj = new Map<string, string[]>();
const edgesByFile = new Map<string, Edge[]>();
const extendsByFile = new Map<string, Set<string>>();

for (const file of files) {
	let text = readFileSync(file, "utf8");
	if (file.endsWith(".svelte")) {
		// Closing tag tolerates whitespace (`</script >`) to satisfy CodeQL
		// js/bad-tag-filter; we only parse our own trusted Svelte sources here.
		const m = text.match(/<script[^>]*>([\s\S]*?)<\/script\s*>/i);
		text = m ? m[1] : "";
	}

	const extendsNames = new Set<string>();
	for (const m of text.matchAll(EXTENDS_RE)) extendsNames.add(m[1]);
	extendsByFile.set(file, extendsNames);

	const merged = new Map<string, Edge>();
	for (const m of text.matchAll(IMPORT_RE)) {
		const typeOnly = !!m[1];
		const clause = m[2].trim();
		const to = resolveSpec(file, m[4]);
		if (!to || to === file) continue;

		const names = new Set<string>();
		// default import (leading identifier, when not a `{...}` / `* as` clause)
		if (!clause.startsWith("{") && !clause.startsWith("*")) {
			const def = clause.match(/^([A-Za-z_$][\w$]*)/);
			if (def) names.add(def[1]);
		}
		const brace = clause.match(/\{([^}]*)\}/);
		if (brace) {
			for (const part of brace[1].split(",")) {
				const name = part
					.trim()
					.replace(/^type\s+/, "")
					.split(/\s+as\s+/)[0]
					.trim();
				if (name) names.add(name);
			}
		}

		const existing = merged.get(to);
		if (existing) {
			existing.typeOnly = existing.typeOnly && typeOnly;
			for (const n of names) existing.names.add(n);
		} else {
			merged.set(to, { to, typeOnly, names });
		}
	}

	const edges = [...merged.values()];
	edgesByFile.set(file, edges);
	valueAdj.set(
		file,
		edges.filter((e) => !e.typeOnly).map((e) => e.to),
	);
}

// Tarjan SCC over the value-import graph (type-only edges erased at build time).
function stronglyConnectedComponents(): Map<string, number> {
	let index = 0;
	const stack: string[] = [];
	const onStack = new Set<string>();
	const idx = new Map<string, number>();
	const low = new Map<string, number>();
	const sccId = new Map<string, number>();
	let nextScc = 0;

	const strongconnect = (v: string) => {
		idx.set(v, index);
		low.set(v, index);
		index++;
		stack.push(v);
		onStack.add(v);
		for (const w of valueAdj.get(v) ?? []) {
			if (!idx.has(w)) {
				strongconnect(w);
				low.set(v, Math.min(low.get(v)!, low.get(w)!));
			} else if (onStack.has(w)) {
				low.set(v, Math.min(low.get(v)!, idx.get(w)!));
			}
		}
		if (low.get(v) === idx.get(v)) {
			const id = nextScc++;
			let w: string;
			do {
				w = stack.pop()!;
				onStack.delete(w);
				sccId.set(w, id);
			} while (w !== v);
		}
	};

	// Iterative-safe for this graph size (~260 nodes); recursion depth is bounded.
	for (const v of valueAdj.keys()) if (!idx.has(v)) strongconnect(v);
	return sccId;
}

describe("import cycles (#1249 regression guard)", () => {
	it("no class extends a base value-imported from its own dependency cycle", () => {
		const sccId = stronglyConnectedComponents();
		const offenders: string[] = [];

		for (const [file, extendsNames] of extendsByFile) {
			if (extendsNames.size === 0) continue;
			const myScc = sccId.get(file);
			for (const edge of edgesByFile.get(file) ?? []) {
				if (edge.typeOnly) continue;
				if (sccId.get(edge.to) !== myScc) continue; // different SCC -> safe
				for (const name of edge.names) {
					if (extendsNames.has(name)) {
						offenders.push(
							`${relative(ROOT, file)} extends ${name} (value-imported from ${relative(ROOT, edge.to)} in the same import cycle)`,
						);
					}
				}
			}
		}

		expect(
			offenders,
			`Found class inheritance across an import cycle — this is exactly the "Class extends value undefined" hazard from #1249.\n` +
				`Break the cycle (lazy \`await import()\`, a leaf holder module, or \`import type\`) so the base class's module never transitively value-imports its subclass.\n` +
				offenders.map((o) => `  - ${o}`).join("\n"),
		).toEqual([]);
	});
});
