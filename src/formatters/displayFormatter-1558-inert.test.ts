import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import { Formatter } from "./formatter";
import { describePreviewFailure } from "./previewDiagnostics";
import type QuickAdd from "../main";
import { LogManager } from "../logger/logManager";
import type { ILogger } from "../logger/ilogger";

// The preview never reaches a template in these cases, and SingleTemplateEngine's
// module graph pulls obsidian-dataview's CJS require.
vi.mock("../engine/SingleTemplateEngine", () => ({
	SingleTemplateEngine: class {
		run(): Promise<string> {
			return Promise.resolve("");
		}
	},
}));

const app = {
	workspace: { getActiveFile: () => null },
	vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
	metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
} as unknown as App;

const plugin = {
	settings: { globalVariables: {}, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

let reported: string[] = [];

beforeEach(() => {
	reported = [];
	LogManager.loggers = [
		{
			logError: (m: string) => reported.push(`error ${m}`),
			logWarning: (m: string) => reported.push(`warning ${m}`),
			logMessage: () => {},
		} as unknown as ILogger,
	];
});

/**
 * Types `head + arg + tail` one character of `arg` at a time, the way the token
 * autocomplete leaves the caret: it inserts `{{VALUE:}}` with the closing braces
 * already present, so every prefix of an argument is a COMPLETE, invalid token.
 * Returns how many Notices the whole session produced.
 */
async function typeArgument(
	make: () => FormatDisplayFormatter | FileNameDisplayFormatter,
	head: string,
	arg: string,
	tail = "}}",
) {
	const diagnostics: string[] = [];
	for (let i = 1; i <= arg.length; i++) {
		const formatter = make();
		await formatter.format(head + arg.slice(0, i) + tail);
		for (const entry of formatter.diagnostics.list()) {
			diagnostics.push(entry.message);
		}
	}
	return { notices: reported.length, diagnostics };
}

/**
 * Issue #1558. Every row of the measurement in the issue, re-run against the
 * real display formatters. Each of these fired one Obsidian Notice per keystroke
 * (two, on the anonymous form) before this change.
 */
describe("#1558 the live format preview never fires a Notice", () => {
	const rows: Array<[label: string, head: string, arg: string]> = [
		["named |case:", "{{VALUE:title|case:", "pascal"],
		["named |type:", "{{VALUE:x|type:", "number"],
		["anonymous |type:", "{{VALUE|type:", "number"],
		["anonymous |type:slider", "{{VALUE|type:", "slider"],
		["named |name:", "{{VALUE:title|name:", "cat"],
		["unknown FIELD filter", "{{FIELD:status|", "fodler:abc"],
	];

	for (const [label, head, arg] of rows) {
		it(`stays silent while typing ${label}`, async () => {
			const { notices } = await typeArgument(
				() => new FormatDisplayFormatter(app, plugin),
				head,
				arg,
			);
			expect(notices).toBe(0);
		});

		it(`stays silent in the file-name preview while typing ${label}`, async () => {
			const { notices } = await typeArgument(
				() => new FileNameDisplayFormatter(app, plugin),
				head,
				arg,
			);
			expect(notices).toBe(0);
		});
	}

	it("collects the problem instead of dropping it", async () => {
		const formatter = new FormatDisplayFormatter(app, plugin);
		await formatter.format("{{VALUE:title|case:pasc}}");

		expect(reported).toEqual([]);
		expect(formatter.diagnostics.list()).toEqual([
			{
				severity: "warning",
				message:
					'Unsupported |case style "pasc" in token "{{VALUE:title|case:pasc}}". Supported styles: kebab, snake, camel, pascal, title, lower, upper, slug.',
			},
		]);
	});

	it("strips the redundant QuickAdd: prefix from collected messages", async () => {
		const formatter = new FormatDisplayFormatter(app, plugin);
		await formatter.format("{{VALUE:x|type:numbr}}");
		for (const entry of formatter.diagnostics.list()) {
			expect(entry.message.startsWith("QuickAdd:")).toBe(false);
		}
	});

	it("reports the same malformed token once, not once per occurrence", async () => {
		const formatter = new FormatDisplayFormatter(app, plugin);
		await formatter.format("{{VALUE:t|case:pasc}} and {{VALUE:t|case:pasc}}");
		expect(formatter.diagnostics.list()).toHaveLength(1);
	});

	it("starts each pass from a clean slate", async () => {
		const formatter = new FormatDisplayFormatter(app, plugin);
		await formatter.format("{{VALUE:title|case:pasc}}");
		expect(formatter.diagnostics.list()).toHaveLength(1);
		await formatter.format("{{VALUE:title|case:pascal}}");
		expect(formatter.diagnostics.list()).toEqual([]);
	});

	it("surfaces a THROWN parse failure instead of silently echoing the input", async () => {
		const formatter = new FormatDisplayFormatter(app, plugin);
		// |text: on a token whose option list has a different arity throws.
		const out = await formatter.format("{{VALUE:a,b|text:x}}");

		expect(out).toBe("{{VALUE:a,b|text:x}}");
		expect(reported).toEqual([]);
		const entries = formatter.diagnostics.list();
		expect(entries).toHaveLength(1);
		expect(entries[0].severity).toBe("error");
		expect(formatter.diagnostics.hasError).toBe(true);
	});

	it("drops a cancellation rather than reporting it as a preview failure", async () => {
		// QuickAdd's modals reject with a bare STRING, not an Error
		// (GenericInputPrompt.ts: `rejectPromise("No input given.")`), and
		// isCancellationError only ever matches strings.
		expect(describePreviewFailure("No input given.")).toBeNull();
		expect(describePreviewFailure("no input given.")).toBeNull();
		expect(describePreviewFailure("cancelled")).toBeNull();
		expect(describePreviewFailure(new Error("cancelled"))).toBeNull();
		// Anything else still reports.
		expect(describePreviewFailure("something else")).not.toBeNull();
		expect(describePreviewFailure(new Error("real problem"))).toBe(
			"real problem",
		);
	});

	it("gives the half-typed {{VALUE:}} the autocomplete inserts real copy", async () => {
		const formatter = new FormatDisplayFormatter(app, plugin);
		await formatter.format("{{VALUE:}}");
		expect(formatter.diagnostics.list()).toEqual([
			{
				severity: "error",
				message:
					"This token is incomplete. {{VALUE:}} needs a name, for example {{VALUE:title}}.",
			},
		]);
	});
});

/**
 * The other half of the contract: a formatter that does NOT override the hooks
 * still warns. A preview that goes quiet is only correct because the
 * authoritative run is still loud, and `CompleteFormatter` inherits these
 * defaults untouched.
 */
describe("#1558 a formatter that does not override the hooks still warns", () => {
	class RuntimeFormatter extends Formatter {
		constructor() {
			super(undefined);
		}
		protected async format(input: string): Promise<string> {
			return input;
		}
		public runAnonymous(input: string): Promise<string> {
			return this.replaceValueInString(input);
		}
		public runNamed(input: string): Promise<string> {
			return this.replaceVariableInString(input);
		}
		protected async promptForValue(): Promise<string> {
			return "";
		}
		protected async promptForVariable(): Promise<string> {
			return "";
		}
		protected async suggestForValue(): Promise<string> {
			return "";
		}
		protected async suggestForField(): Promise<string> {
			return "";
		}
		protected suggestForFile(): string {
			return "";
		}
		protected getVariableValue(): string {
			return "";
		}
		protected getCurrentFileLink(): string | null {
			return null;
		}
		protected async getMacroValue(): Promise<string> {
			return "";
		}
		protected async promptForMathValue(): Promise<string> {
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
		protected isTemplatePropertyTypesEnabled(): boolean {
			return false;
		}
		protected getCurrentFileName(): string | null {
			return null;
		}
	}

	it("warns for a named |case: typo", async () => {
		await new RuntimeFormatter().runNamed("{{VALUE:title|case:pasc}}");
		expect(
			reported.some((m) => m.includes('Unsupported |case style "pasc"')),
		).toBe(true);
	});

	it("warns exactly once for an anonymous |type: typo", async () => {
		await new RuntimeFormatter().runAnonymous("{{VALUE|type:numbr}}");
		expect(
			reported.filter((m) => m.includes('Unsupported VALUE type "numbr"')),
		).toHaveLength(1);
	});
});
