import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import type { App } from "obsidian";
import FormatPreviewField from "./FormatPreviewField.svelte";
import type QuickAdd from "../../../main";
import { LogManager } from "../../../logger/logManager";
import type { ILogger } from "../../../logger/ilogger";

// SingleTemplateEngine's module graph pulls obsidian-dataview's CJS require; the
// preview no longer uses it, but FileNameDisplayFormatter's siblings still
// import through the same barrel in this environment.
vi.mock("../../../engine/SingleTemplateEngine", () => ({
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
	vi.useFakeTimers();
	reported = [];
	LogManager.loggers = [
		{
			logError: (m: string) => reported.push(m),
			logWarning: (m: string) => reported.push(m),
			logMessage: () => {},
		} as unknown as ILogger,
	];
});

afterEach(() => {
	vi.useRealTimers();
});

/**
 * Lets the async preview pass settle without advancing the idle timer. Under
 * fake timers the formatter's promise chain needs its microtasks flushed;
 * advancing by 0ms does that and cannot reach the 500ms diagnostics gate.
 */
async function settle() {
	for (let i = 0; i < 4; i++) {
		await vi.advanceTimersByTimeAsync(0);
		await tick();
	}
}

/** Settles, then advances past the diagnostics idle gate. */
async function settleAndIdle() {
	await settle();
	await vi.advanceTimersByTimeAsync(600);
	await settle();
}

const issues = (container: HTMLElement) =>
	Array.from(container.querySelectorAll(".qa-preview-issue")).map((el) =>
		el.textContent?.trim(),
	);

describe("FormatPreviewField", () => {
	it("shows nothing while the field is empty", async () => {
		const { container } = render(FormatPreviewField, {
			props: { value: "", app, plugin },
		});
		await settleAndIdle();
		expect(container.querySelector(".qa-preview-row")).toBeNull();
	});

	it("previews a resolvable format and reports no problems", async () => {
		const { container } = render(FormatPreviewField, {
			props: { value: "{{VALUE:title|case:pascal}}", app, plugin },
		});
		await settleAndIdle();

		expect(container.querySelector(".qa-preview-label")?.textContent).toBe(
			"Preview: ",
		);
		expect(container.querySelector(".qa-preview-value")?.textContent).not.toBe(
			"",
		);
		expect(issues(container as HTMLElement)).toEqual([]);
	});

	it("shows a token problem inline instead of firing a Notice", async () => {
		const { container } = render(FormatPreviewField, {
			props: { value: "{{VALUE:title|case:pasc}}", app, plugin },
		});
		await settleAndIdle();

		expect(reported).toEqual([]);
		expect(issues(container as HTMLElement)).toEqual([
			'Unsupported |case style "pasc" in token "{{VALUE:title|case:pasc}}". Supported styles: kebab, snake, camel, pascal, title, lower, upper, slug.',
		]);
	});

	it("holds the problem back until the field has been still", async () => {
		const { container } = render(FormatPreviewField, {
			props: { value: "{{VALUE:title|case:pasc}}", app, plugin },
		});
		await settle();

		// Resolved, but not yet idle: the preview text is live, the complaint is not.
		expect(container.querySelector(".qa-preview-value")?.textContent).not.toBe(
			"",
		);
		expect(issues(container as HTMLElement)).toEqual([]);

		await vi.advanceTimersByTimeAsync(600);
		await settle();
		expect(issues(container as HTMLElement)).toHaveLength(1);
	});

	it("hides a shown problem again as soon as typing resumes", async () => {
		const { container, rerender } = render(FormatPreviewField, {
			props: { value: "{{VALUE:title|case:pasc}}", app, plugin },
		});
		await settleAndIdle();
		expect(issues(container as HTMLElement)).toHaveLength(1);

		await rerender({ value: "{{VALUE:title|case:pasca}}", app, plugin });
		await settle();
		expect(issues(container as HTMLElement)).toEqual([]);
	});

	it("stops asserting the raw text is the output when nothing resolved", async () => {
		const { container } = render(FormatPreviewField, {
			props: { value: "{{VALUE:a,b|text:x}}", app, plugin },
		});
		await settleAndIdle();

		expect(container.querySelector(".qa-preview-label")?.textContent).toBe(
			"Unresolved: ",
		);
		expect(
			container.querySelector(".qa-preview-issue--error"),
		).not.toBeNull();
	});

	it("re-previews an edited named option list instead of the stale first value", async () => {
		// The formatter used to be memoized for the field's lifetime. Its
		// `variables` map short-circuits an already-resolved key, so editing the
		// option list of a `|name:`d token kept previewing the FIRST list's value
		// and tripped the "conflicting definitions" warn-once guard - which, before
		// this fix, was an on-screen Notice fired from a keystroke.
		const { container, rerender } = render(FormatPreviewField, {
			props: { value: "{{VALUE:alpha,beta|name:t}}", app, plugin },
		});
		await settleAndIdle();
		expect(container.querySelector(".qa-preview-value")?.textContent).toContain(
			"alpha",
		);

		await rerender({ value: "{{VALUE:gamma,delta|name:t}}", app, plugin });
		await settleAndIdle();
		expect(container.querySelector(".qa-preview-value")?.textContent).toContain(
			"gamma",
		);
		expect(issues(container as HTMLElement)).toEqual([]);
		expect(reported).toEqual([]);
	});

	it("clears the problem when the field is emptied", async () => {
		const { container, rerender } = render(FormatPreviewField, {
			props: { value: "{{VALUE:title|case:pasc}}", app, plugin },
		});
		await settleAndIdle();
		expect(issues(container as HTMLElement)).toHaveLength(1);

		await rerender({ value: "", app, plugin });
		await settleAndIdle();
		expect(container.querySelector(".qa-preview-row")).toBeNull();
	});
});
