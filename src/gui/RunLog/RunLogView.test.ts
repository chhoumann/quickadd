import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import type { App } from "obsidian";
import { runLog, type RunLogEntry } from "../../runLog";
import RunLogView from "./RunLogView.svelte";

const REASON = "Weekly review: the template Templates/Nowhere.md does not exist, so no note was created.";

function entry(overrides: Partial<RunLogEntry>): RunLogEntry {
	return { at: "2026-10-06T09:00:00.000Z", choiceId: "weekly", choiceName: "Weekly review", status: "error", durationMs: 5, ...overrides };
}

describe("RunLogView", () => {
	afterEach(() => runLog.clear());

	it("puts a failed run's reason on a line of its own under the row, keeping the tooltip", () => {
		runLog.append(entry({ reason: REASON }));
		const { container } = render(RunLogView, { props: { app: {} as App } });

		const what = container.querySelector(".qa-run-log-line .qa-run-log-what");
		expect(what?.textContent).toBe("failed");
		expect(what?.getAttribute("title")).toBe(REASON);
		expect(container.querySelector(".qa-run-log-body > .qa-run-log-reason")?.textContent).toBe(REASON);
	});

	it("keeps a cancelled run's reason in the row", () => {
		runLog.append(entry({ status: "cancelled", reason: "Dismissed the form" }));
		const { container } = render(RunLogView, { props: { app: {} as App } });

		expect(container.querySelector(".qa-run-log-what")?.textContent).toBe("cancelled: Dismissed the form");
		expect(container.querySelector(".qa-run-log-reason")).toBeNull();
	});
});
