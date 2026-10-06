import { describe, expect, it } from "vitest";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { buttonBlockFor, parseButtonBlock, resolveButtonRef } from "./buttonBlock";

const choice = (id: string, name: string): IChoice => ({ id, name, type: "Capture", command: false }) as IChoice;
const folder = (id: string, name: string, choices: IChoice[]): IMultiChoice =>
	({ id, name, type: "Multi", command: false, choices, collapsed: false }) as IMultiChoice;

describe("parseButtonBlock", () => {
	it("reads names, ids and labels, one per line", () => {
		expect(parseButtonBlock("Log\nid: 1234-abcd\nTask | Add a task\nid:5678 | By id\n")).toEqual([
			{ ref: { by: "name", value: "Log" }, label: null },
			{ ref: { by: "id", value: "1234-abcd" }, label: null },
			{ ref: { by: "name", value: "Task" }, label: "Add a task" },
			{ ref: { by: "id", value: "5678" }, label: "By id" },
		]);
	});

	it("trims, skips blank lines and # comments, and reads CRLF", () => {
		expect(parseButtonBlock("\r\n  # Morning\r\n  Log  \r\n\r\n# Task\r\n")).toEqual([
			{ ref: { by: "name", value: "Log" }, label: null },
		]);
	});

	it("keeps the name when the label after the pipe is empty", () => {
		expect(parseButtonBlock("Log |")).toEqual([{ ref: { by: "name", value: "Log" }, label: null }]);
	});

	it("marks a line that names no choice as unreadable", () => {
		expect(parseButtonBlock("| Journal\nid:\nid: | Label")).toEqual([
			{ unreadable: "| Journal" },
			{ unreadable: "id:" },
			{ unreadable: "id: | Label" },
		]);
	});
});

describe("resolveButtonRef", () => {
	const log = choice("log", "Log");
	const task = choice("task", "Task");
	const nested = choice("nested", "Weekly review");
	const choices = [log, task, folder("f", "Reviews", [nested])];

	it("finds a choice by its exact name, inside folders too", () => {
		expect(resolveButtonRef({ by: "name", value: "Log" }, choices)).toEqual({ choice: log });
		expect(resolveButtonRef({ by: "name", value: "Weekly review" }, choices)).toEqual({ choice: nested });
	});

	it("finds a choice by its name ignoring case when nothing matches exactly", () => {
		expect(resolveButtonRef({ by: "name", value: "weekly REVIEW" }, choices)).toEqual({ choice: nested });
	});

	it("prefers the exact name over a match ignoring case", () => {
		const lower = choice("lower", "log");
		expect(resolveButtonRef({ by: "name", value: "log" }, [log, lower])).toEqual({ choice: lower });
	});

	it("reports several choices sharing the name", () => {
		expect(resolveButtonRef({ by: "name", value: "Log" }, [log, choice("log2", "Log")])).toEqual({
			problem: "Several choices named 'Log'",
		});
		expect(resolveButtonRef({ by: "name", value: "LOG" }, [log, choice("log2", "log")])).toEqual({
			problem: "Several choices named 'LOG'",
		});
	});

	it("reports a name or an id that matches nothing", () => {
		expect(resolveButtonRef({ by: "name", value: "Journal" }, choices)).toEqual({ problem: "No choice named 'Journal'" });
		expect(resolveButtonRef({ by: "id", value: "gone" }, choices)).toEqual({ problem: "No choice with id 'gone'" });
	});

	it("finds a choice by id", () => {
		expect(resolveButtonRef({ by: "id", value: "nested" }, choices)).toEqual({ choice: nested });
	});
});

describe("buttonBlockFor", () => {
	it("names the choice when its name finds it", () => {
		const log = choice("log", "Log");
		expect(buttonBlockFor(log, [log, choice("task", "Task")])).toBe("```quickadd\nLog\n```\n");
	});

	it("uses the id when another choice shares the name", () => {
		const log = choice("log", "Log");
		expect(buttonBlockFor(log, [log, folder("f", "Old", [choice("log2", "Log")])])).toBe("```quickadd\nid: log\n```\n");
	});

	it("uses the id when the name would not read back as that choice", () => {
		for (const name of ["Log | today", "# Inbox", "id: x", " "]) {
			const odd = choice("odd", name);
			expect(buttonBlockFor(odd, [odd])).toBe("```quickadd\nid: odd\n```\n");
		}
	});
});
