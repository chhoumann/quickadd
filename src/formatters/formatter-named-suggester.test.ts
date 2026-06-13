import { afterEach, describe, expect, it, vi } from "vitest";
import { Formatter, type PromptContext } from "./formatter";

/**
 * Exercises the REAL Formatter.replaceVariableInString (two-pass named-suggester
 * resolution + ensureValueVariableResolved) for issue #148. Only the abstract
 * UI/IO hooks are stubbed; prompt/suggest calls are logged so we can assert that
 * a named suggester is shown exactly once and reused without a free-text prompt.
 */
class TestFormatter extends Formatter {
	public calls: string[] = [];
	public suggestReturns = new Map<string, string>();
	public promptReturns = new Map<string, string>();

	constructor() {
		super(undefined);
	}

	public run(input: string): Promise<string> {
		return this.replaceVariableInString(input);
	}

	public getVar(key: string): unknown {
		return this.variables.get(key);
	}

	public seed(key: string, value: unknown): void {
		this.variables.set(key, value);
	}

	protected async format(input: string): Promise<string> {
		return input;
	}
	protected async promptForValue(): Promise<string> {
		return "";
	}
	protected async promptForVariable(
		variableName?: string,
		context?: PromptContext,
	): Promise<string> {
		const key = context?.variableKey ?? variableName ?? "";
		this.calls.push(`prompt:${key}`);
		return this.promptReturns.get(key) ?? `typed(${variableName})`;
	}
	protected async suggestForValue(
		suggestedValues: string[],
		_allowCustomInput?: boolean,
		context?: {
			placeholder?: string;
			variableKey?: string;
			displayValues?: string[];
			optional?: boolean;
		},
	): Promise<string> {
		const key = context?.variableKey ?? "";
		this.calls.push(
			`suggest:${key}:[${suggestedValues.join(",")}]:ph=${context?.placeholder ?? ""}`,
		);
		return this.suggestReturns.get(key) ?? suggestedValues[0];
	}
	protected async suggestForField(): Promise<string> {
		return "";
	}
	protected async getMacroValue(): Promise<string> {
		return "";
	}
	protected async getTemplateContent(): Promise<string> {
		return "";
	}
	protected async getSelectedText(): Promise<string> {
		return "";
	}
	protected async getClipboardContent(): Promise<string> {
		return "";
	}
	protected getCurrentFileLink(): string | null {
		return null;
	}
	protected getCurrentFileName(): string | null {
		return null;
	}
	protected getVariableValue(variableName: string): string {
		return String(this.variables.get(variableName) ?? "");
	}
	protected async promptForMathValue(): Promise<string> {
		return "";
	}
	protected isTemplatePropertyTypesEnabled(): boolean {
		return false;
	}
}

describe("named suggester (#148)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("stores the suggester pick under the name and reuses it without re-prompting", async () => {
		const f = new TestFormatter();
		f.suggestReturns.set("category", "work");

		const out = await f.run(
			"# {{VALUE:work,home,errand|name:category}}\ntags: #{{VALUE:category}}",
		);

		expect(out).toBe("# work\ntags: #work");
		// Exactly one suggester, no free-text prompt for the reuse site.
		expect(f.calls.filter((c) => c.startsWith("suggest:"))).toHaveLength(1);
		expect(f.calls.some((c) => c.startsWith("prompt:"))).toBe(false);
		expect(f.getVar("category")).toBe("work");
	});

	it("is order-independent within a string: reuse BEFORE definition still shows the suggester", async () => {
		const f = new TestFormatter();
		f.suggestReturns.set("category", "home");

		const out = await f.run(
			"tags: #{{VALUE:category}}\ntitle: {{VALUE:work,home|name:category}}",
		);

		expect(out).toBe("tags: #home\ntitle: home");
		// The named definition was hoisted; the reuse never became a text prompt.
		expect(f.calls.filter((c) => c.startsWith("suggest:"))).toHaveLength(1);
		expect(f.calls.some((c) => c.startsWith("prompt:"))).toBe(false);
	});

	it("does NOT hoist a single-use named suggester ahead of an earlier prompt", async () => {
		const f = new TestFormatter();
		f.promptReturns.set("first", "A");
		f.suggestReturns.set("kind", "x");

		await f.run("{{VALUE:first}} then {{VALUE:x,y|name:kind}}");

		// No reuse of `kind`, so document order is preserved: prompt before suggest.
		expect(f.calls).toEqual([
			"prompt:first",
			"suggest:kind:[x,y]:ph=",
		]);
	});

	it("does NOT hoist when the reuse comes AFTER the definition (document order kept)", async () => {
		const f = new TestFormatter();
		f.promptReturns.set("first", "A");
		f.suggestReturns.set("kind", "x");

		// def at pos 2, reuse at pos 3 — no use precedes the def, so document
		// order resolves it; `first` must still be prompted before the suggester.
		await f.run(
			"{{VALUE:first}} {{VALUE:x,y|name:kind}} {{VALUE:kind}}",
		);

		expect(f.calls).toEqual(["prompt:first", "suggest:kind:[x,y]:ph="]);
	});

	it("keeps the FIRST definition when two same-name defs have no preceding reuse", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const f = new TestFormatter();
		f.suggestReturns.set("type", "a");

		// No bare reuse precedes either definition, so neither is hoisted; document
		// order wins → the first definition's options/value are used for both.
		const out = await f.run(
			"x={{VALUE:a,b|name:type}} y={{VALUE:c,d|name:type}}",
		);

		expect(out).toBe("x=a y=a");
		// Only the first definition's suggester is shown ([a,b], not [c,d]).
		const suggests = f.calls.filter((c) => c.startsWith("suggest:"));
		expect(suggests).toEqual(["suggest:type:[a,b]:ph="]);
		expect(
			warn.mock.calls.some((c) =>
				String(c[0]).includes("different option lists"),
			),
		).toBe(true);
	});

	it("warns when the same name differs only by the custom flag", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const f = new TestFormatter();
		f.suggestReturns.set("kind", "a");

		await f.run("{{VALUE:a,b|name:kind}} {{VALUE:a,b|name:kind|custom}}");

		expect(
			warn.mock.calls.some((c) =>
				String(c[0]).includes("different option lists"),
			),
		).toBe(true);
	});

	it("does not show a suggester when an earlier token is malformed (aborts hoisting)", async () => {
		const f = new TestFormatter();
		f.suggestReturns.set("cat", "p");

		// The first token is invalid (text mapping on a single value); the pre-pass
		// must abort so the main pass throws before any suggester is shown.
		await expect(
			f.run("{{VALUE:bad|text:Only}} {{VALUE:p,q|name:cat}} {{VALUE:cat}}"),
		).rejects.toThrow();
		expect(f.calls.some((c) => c.startsWith("suggest:"))).toBe(false);
	});

	it("uses |label as the suggester placeholder while keying on |name", async () => {
		const f = new TestFormatter();
		f.suggestReturns.set("category", "home");

		await f.run(
			"{{VALUE:work,home|name:category|label:Pick a category}}\n{{VALUE:category}}",
		);

		expect(f.calls[0]).toBe(
			"suggest:category:[work,home]:ph=Pick a category",
		);
		expect(f.getVar("category")).toBe("home");
	});

	it("warns and keeps the first value when a name is reused with different options", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const f = new TestFormatter();
		f.suggestReturns.set("type", "bug");

		const out = await f.run(
			"a={{VALUE:bug,feature|name:type}} b={{VALUE:book,movie|name:type}}",
		);

		// First-write-wins; the second definition reuses "bug" (out of its own
		// option set) and emits a warning rather than re-prompting.
		expect(out).toBe("a=bug b=bug");
		expect(f.calls.filter((c) => c.startsWith("suggest:"))).toHaveLength(1);
		expect(
			warn.mock.calls.some((c) =>
				String(c[0]).includes("different option lists"),
			),
		).toBe(true);
	});

	it("does NOT warn when a seeded value is not one of the options (no false positive)", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const f = new TestFormatter();
		// Simulate api.format / a script / the one-page form pre-seeding the name
		// with a value outside the literal option list.
		f.seed("category", "work-from-home");

		const out = await f.run(
			"# {{VALUE:work,home|name:category}}\ntags: #{{VALUE:category}}",
		);

		expect(out).toBe("# work-from-home\ntags: #work-from-home");
		expect(f.calls).toHaveLength(0); // fully resolved from the seed, no prompts
		expect(warn).not.toHaveBeenCalled();
	});

	it("reuses across separate format passes that share the variables map", async () => {
		const f = new TestFormatter();
		f.suggestReturns.set("category", "errand");

		// Simulate filename pass then body pass on the same formatter instance.
		const name = await f.run("{{VALUE:work,home,errand|name:category}}");
		const body = await f.run("category: {{VALUE:category}}");

		expect(name).toBe("errand");
		expect(body).toBe("category: errand");
		expect(f.calls.filter((c) => c.startsWith("suggest:"))).toHaveLength(1);
	});
});
