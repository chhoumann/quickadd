import { createFile, createMockApp } from "../../tests/helpers/formatters/captureFixtures";
import { createSelectionFormatterPlugin } from "../../tests/helpers/formatters/plugin";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

// Mocks mirror captureChoiceFormatter-linebreak.test.ts so the formatter can run
// under jsdom without real Obsidian/Templater.
vi.mock("../utilityObsidian", async () => (await import("../../tests/helpers/formatters/mocks")).utilityObsidianMock());
vi.mock("obsidian-dataview", async () => (await import("../../tests/helpers/formatters/mocks")).obsidiandataviewMock());

import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

const insertAfter = (after: string, insertAtEnd = false) => ({
	enabled: true,
	after,
	insertAtEnd,
	considerSubsections: false,
	createIfNotFound: false,
	createIfNotFoundLocation: "",
	inline: false,
	replaceExisting: false,
	blankLineAfterMatchMode: "auto" as const,
});

const createChoice = (
	overrides: Partial<ICaptureChoice> = {},
): ICaptureChoice =>
	({
		id: "test",
		name: "Test Choice",
		type: "Capture",
		command: false,
		captureTo: "Target.md",
		captureToActiveFile: false,
		captureToCanvasNodeId: "",
		activeFileWritePosition: "cursor",
		createFileIfItDoesntExist: {
			enabled: false,
			createWithTemplate: false,
			template: "",
		},
		format: { enabled: true, format: "{{VALUE}}" },
		prepend: false,
		appendLink: false,
		task: true,
		insertAfter: insertAfter("===== Task ======"),
		newLineCapture: { enabled: false, direction: "below" },
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		...overrides,
	}) as ICaptureChoice;

const createFormatter = () =>
	new CaptureChoiceFormatter(createMockApp(), createSelectionFormatterPlugin());

beforeEach(() => {
	(global as any).navigator = {
		clipboard: { readText: vi.fn().mockResolvedValue("") },
	};
});

/**
 * Mirrors CaptureChoiceEngine.getCaptureContent(): "Format value as task" wraps
 * the format string and appends a trailing newline so a bare task is a complete
 * line. The blank-line bug (#312) lives in how that injected newline is joined,
 * so the test must feed the same task-shaped input the engine produces.
 */
const taskInput = (value: string) => `- [ ] ${value}\n`;

describe("issue #312 — no blank line after a task-formatted capture (insert after)", () => {
	it("does not add a blank line when the target has a blank line directly below it", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\n\nold one\n",
			createFile(),
		);

		expect(result).toBe("===== Task ======\n- [ ] buy milk\nold one\n");
		expect(result).not.toMatch(/- \[ \] buy milk\n\n/);
	});

	it("does not add a trailing blank when the target is followed only by a blank line at EOF", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\n\n",
			createFile(),
		);

		expect(result).toBe("===== Task ======\n- [ ] buy milk\n");
	});

	it("keeps the task on its own line (no glue) when content sits directly below the target", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\nold one\n",
			createFile(),
		);

		expect(result).toBe("===== Task ======\n- [ ] buy milk\nold one\n");
	});

	it("stacks repeated task captures tightly with no accumulating blank lines", async () => {
		let body = "===== Task ======\n\n";
		for (const value of ["A", "B", "C"]) {
			body = await createFormatter().formatContentWithFile(
				taskInput(value),
				createChoice(),
				body,
				createFile(),
			);
		}

		expect(body).toBe("===== Task ======\n- [ ] C\n- [ ] B\n- [ ] A\n");
		expect(body).not.toMatch(/\n[ \t]*\n/);
	});

	it("collapses the injected newline on the insert-at-end-of-section path too", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("new task"),
			createChoice({ insertAfter: insertAfter("## Task", true) }),
			"## Task\n- old\n\n## Other\nx\n",
			createFile(),
		);

		expect(result).toBe("## Task\n- old\n- [ ] new task\n## Other\nx\n");
		expect(result).not.toMatch(/- \[ \] new task\n\n/);
	});

	it("recognises a whitespace-only blank line directly below the target", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\n   \nold one\n",
			createFile(),
		);

		expect(result).not.toMatch(/- \[ \] buy milk\n[ \t]*\n/);
	});

	it("recognises a CRLF blank line directly below the target (#312 on Windows notes)", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\r\n\r\nold one\r\n",
			createFile(),
		);

		// No blank line after the task, and the CRLF following content is preserved.
		expect(result).toBe("===== Task ======\r\n- [ ] buy milk\r\nold one\r\n");
	});

	it("recognises a real blank last line when the body has no trailing newline", async () => {
		// "anchor\n   " — the final split slot is genuine whitespace content, not the
		// trailing-newline artifact, so the injected task newline must still collapse.
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\n   ",
			createFile(),
		);

		expect(result).not.toMatch(/- \[ \] buy milk\n[ \t]*\n/);
		expect(result.startsWith("===== Task ======\n- [ ] buy milk")).toBe(true);
	});

	it("keeps the EOF trailing-newline slot intact (does not collapse it as a blank line)", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\n",
			createFile(),
		);

		// Target is the last real line with only the trailing-newline artifact below:
		// the task keeps its own terminating newline, no content is glued or dropped.
		expect(result).toBe("===== Task ======\n- [ ] buy milk\n");
	});

	it("leaves a user-typed trailing newline in the format string untouched (gate is off for task: false)", async () => {
		// Guard/scope test: this passes with OR without the fix because the gate is
		// gated on choice.task. It pins the gate scope so a non-task capture whose
		// format intentionally ends in a newline keeps that explicit newline.
		const result = await createFormatter().formatContentWithFile(
			"buy milk\n",
			createChoice({ task: false }),
			"===== Task ======\n\nold one\n",
			createFile(),
		);

		expect(result).toBe("===== Task ======\nbuy milk\n\nold one\n");
	});
});
