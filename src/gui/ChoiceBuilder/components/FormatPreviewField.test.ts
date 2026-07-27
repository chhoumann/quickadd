import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/svelte";
import { tick } from "svelte";
import type { App } from "obsidian";
import { TFile } from "obsidian";
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

/** The visible text of each problem line (drops the screen-reader severity). */
const issues = (container: HTMLElement) =>
	Array.from(container.querySelectorAll(".qa-preview-issue")).map((el) =>
		Array.from(el.childNodes)
			.filter(
				(n) =>
					!(n instanceof HTMLElement && n.classList.contains("qa-visually-hidden")),
			)
			.map((n) => n.textContent ?? "")
			.join("")
			.trim(),
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

	it("names the severity in text, not colour alone", async () => {
		const { container } = render(FormatPreviewField, {
			props: { value: "{{VALUE:title|case:pasc}}", app, plugin },
		});
		await settleAndIdle();
		expect(
			container.querySelector(".qa-preview-issue .qa-visually-hidden")
				?.textContent,
		).toBe("Warning: ");

		const errored = render(FormatPreviewField, {
			props: { value: "{{VALUE:a,b|text:x}}", app, plugin },
		});
		await settleAndIdle();
		expect(
			errored.container.querySelector(
				".qa-preview-issue .qa-visually-hidden",
			)?.textContent,
		).toBe("Error: ");
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

	describe("the label tells the two error classes apart (#1594)", () => {
		it("says the name will not be created when everything RESOLVED", async () => {
			// Every token resolved; the vault just refuses the result. "Unresolved:"
			// here sent the reader hunting for a broken token that does not exist.
			const { container } = render(FormatPreviewField, {
				props: {
					value: "Bad: {{VALUE:title}}",
					formatterKind: "fileName" as const,
					app,
					plugin,
				},
			});
			await settleAndIdle();

			expect(container.querySelector(".qa-preview-label")?.textContent).toBe(
				"Won't be created: ",
			);
			expect(container.querySelector(".qa-preview-value")?.textContent).toBe(
				"Bad: Example Title",
			);
			expect(
				container.querySelector(".qa-preview-issue--error"),
			).not.toBeNull();
		});

		it("keeps saying Unresolved when a token could not resolve at all", async () => {
			const { container } = render(FormatPreviewField, {
				props: {
					value: "{{TEMPLATE:missing.md}}",
					formatterKind: "fileName" as const,
					app,
					plugin,
				},
			});
			await settleAndIdle();

			expect(container.querySelector(".qa-preview-label")?.textContent).toBe(
				"Unresolved: ",
			);
		});

		it("prefers Unresolved when both classes are present", async () => {
			// A missing template AND an empty path segment: the fundamental failure
			// is that it did not resolve, so that is what the label says.
			const { container } = render(FormatPreviewField, {
				props: {
					value: "{{TEMPLATE:missing.md}}//x",
					formatterKind: "fileName" as const,
					app,
					plugin,
				},
			});
			await settleAndIdle();

			expect(container.querySelector(".qa-preview-label")?.textContent).toBe(
				"Unresolved: ",
			);
		});

		it("says Preview when a pass only produced warnings", async () => {
			const { container } = render(FormatPreviewField, {
				props: { value: "{{VALUE:title}}", app, plugin },
			});
			await settleAndIdle();

			expect(container.querySelector(".qa-preview-label")?.textContent).toBe(
				"Preview: ",
			);
		});
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

/**
 * The row's async pass can outlast the 500ms diagnostics gate (it may read up to
 * 25 templates), so the gate can open while the previous value's result is still
 * on screen. What must never happen is a MIX: a label or a complaint describing
 * one value beside another value's text.
 *
 * Pinned because the obvious "fix" - clearing `diagnostics` when `value`
 * changes - makes it worse, not better: it would leave the previous, known-bad
 * name on screen under a plain "Preview:" label, which is the exact assertion
 * this cluster exists to withdraw.
 */
describe("a slow pass never mixes two values in one row", () => {
	const deferredApp = (release: { fn?: () => void }) =>
		({
			workspace: { getActiveFile: () => null },
			vault: {
				getMarkdownFiles: () => [],
				getAbstractFileByPath: (path: string) =>
					path === "Slow.md"
						? Object.assign(new TFile(), {
								path,
								extension: "md",
								basename: "Slow",
							})
						: null,
				cachedRead: () =>
					new Promise<string>((resolve) => {
						release.fn = () => resolve("Bad: slow body");
					}),
			},
			metadataCache: {
				getFileCache: () => null,
				getAllPropertyInfos: () => ({}),
			},
		}) as unknown as App;

	it("keeps the old value's text under the old value's label until the new pass lands", async () => {
		const release: { fn?: () => void } = {};
		const { container, rerender } = render(FormatPreviewField, {
			props: {
				value: "Bad: {{VALUE:title}}",
				formatterKind: "fileName" as const,
				app: deferredApp(release),
				plugin,
			},
		});
		await settleAndIdle();

		const label = () =>
			container.querySelector(".qa-preview-label")?.textContent;
		const text = () =>
			container.querySelector(".qa-preview-value")?.textContent;

		expect(label()).toBe("Won't be created: ");
		expect(text()).toBe("Bad: Example Title");

		// Switch to a format whose pass cannot finish (the template read hangs),
		// then let the idle gate open while it is still in flight.
		await rerender({ value: "{{TEMPLATE:Slow.md}}" });
		await settleAndIdle();

		// Stale, but COHERENT: the label still describes the text beside it, and
		// the complaint still belongs to that same text.
		expect(text()).toBe("Bad: Example Title");
		expect(label()).toBe("Won't be created: ");
		expect(issues(container as HTMLElement)).toEqual([
			'A file or folder name cannot contain ":", so this choice would fail at run time. Check your own text and tokens like {{TIME}}, which is HH:mm.',
		]);

		// Once it lands, text, label and complaint move together.
		release.fn?.();
		await settleAndIdle();
		expect(text()).toBe("Bad: slow body");
		expect(label()).toBe("Won't be created: ");
	});

	it("drops a stale pass that lands after a newer one", async () => {
		const release: { fn?: () => void } = {};
		const { container, rerender } = render(FormatPreviewField, {
			props: {
				value: "{{TEMPLATE:Slow.md}}",
				formatterKind: "fileName" as const,
				app: deferredApp(release),
				plugin,
			},
		});
		await settle();

		await rerender({ value: "Clean {{VALUE:title}}" });
		await settleAndIdle();
		expect(container.querySelector(".qa-preview-value")?.textContent).toBe(
			"Clean Example Title",
		);

		// The first pass finishes last; previewToken must discard it.
		release.fn?.();
		await settleAndIdle();
		expect(container.querySelector(".qa-preview-value")?.textContent).toBe(
			"Clean Example Title",
		);
		expect(container.querySelector(".qa-preview-label")?.textContent).toBe(
			"Preview: ",
		);
		expect(issues(container as HTMLElement)).toEqual([]);
	});
});
