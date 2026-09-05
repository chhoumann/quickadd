import { describe, expect, it, vi } from "vitest";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import {
	clearPreparedChoiceInputs,
	getPreparedTemplateNoteSelection,
	hasActivePreparedChoiceInputs,
	isDiscoveryMacro,
	markDiscoveryMacro,
	setPreparedChoiceInputs,
	withPreparedChoiceInputs,
} from "./preparedChoiceInputs";

function executor(): IChoiceExecutor {
	return { variables: new Map(), execute: vi.fn() };
}

describe("prepared choice inputs", () => {
	it("keeps repeated Capture answers separate and applies them only during their step", async () => {
		const run = executor();
		for (const [id, value] of [["first", "First capture"], ["second", "Second capture"]]) {
			setPreparedChoiceInputs(run, id, {
				choiceId: "same-capture",
				values: new Map([["value", value]]),
				discovery: null,
			});
		}
		expect(run.variables.has("value")).toBe(false);
		const consumed: unknown[] = [];
		for (const id of ["first", "second"]) {
			await withPreparedChoiceInputs(run, id, async () => {
				await withPreparedChoiceInputs(run, "same-capture", async () => {
					consumed.push(run.variables.get("value"));
				});
			});
			expect(run.variables.has("value")).toBe(false);
		}
		expect(consumed).toEqual(["First capture", "Second capture"]);
	});

	it("preserves explicit API values and values changed by a script", async () => {
		const run = executor();
		run.variables.set("value", "API input");
		setPreparedChoiceInputs(run, "first", {
			choiceId: "capture",
			values: new Map([["value", "Form answer"]]),
			discovery: null,
		});
		await withPreparedChoiceInputs(run, "first", async () => {
			expect(run.variables.get("value")).toBe("API input");
		});
		run.variables.delete("value");
		setPreparedChoiceInputs(run, "second", {
			choiceId: "capture",
			values: new Map([["value", "Form answer"]]),
			discovery: null,
		});
		await withPreparedChoiceInputs(run, "second", async () => {
			run.variables.set("value", "Script output");
		});
		expect(run.variables.get("value")).toBe("Script output");
	});

	it("restores anonymous input and active discovery after cancellation", async () => {
		const run = executor();
		run.variables.set("value", null);
		setPreparedChoiceInputs(run, "step", {
			choiceId: "template",
			values: new Map([["value", "Temporary"]]),
			discovery: { kind: "create", title: "New note" },
		});
		await expect(withPreparedChoiceInputs(run, "step", async () => {
			expect(getPreparedTemplateNoteSelection(run, "template"))
				.toEqual({ kind: "create", title: "New note" });
			expect(getPreparedTemplateNoteSelection(run, "other-template")).toBeNull();
			throw new Error("cancelled");
		})).rejects.toThrow("cancelled");
		expect(run.variables.get("value")).toBeNull();
		expect(hasActivePreparedChoiceInputs(run, "template")).toBe(false);
	});

	it("keeps named answers shared while allowing later script updates to win", async () => {
		const run = executor();
		for (const id of ["first", "second"]) {
			setPreparedChoiceInputs(run, id, {
				choiceId: id,
				values: new Map([["project", "Form project"]]),
				discovery: null,
			});
		}
		await withPreparedChoiceInputs(run, "first", async () => {});
		expect(run.variables.get("project")).toBe("Form project");
		run.variables.set("project", "Script project");
		await withPreparedChoiceInputs(run, "second", async () => {
			expect(run.variables.get("project")).toBe("Script project");
		});
	});

	it("clears queued answers and macro mode at the outer execution boundary", async () => {
		const run = executor();
		markDiscoveryMacro(run, "macro");
		setPreparedChoiceInputs(run, "step", {
			choiceId: "capture",
			values: new Map([["value", "Stale"]]),
			discovery: null,
		});
		clearPreparedChoiceInputs(run);
		expect(isDiscoveryMacro(run, "macro")).toBe(false);
		await withPreparedChoiceInputs(run, "step", async () => {
			expect(run.variables.has("value")).toBe(false);
		});
	});
});
