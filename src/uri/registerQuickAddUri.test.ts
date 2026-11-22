import { beforeEach, describe, expect, it, vi } from "vitest";
import type IChoice from "../types/choices/IChoice";
import type * as ErrorUtils from "../utils/errorUtils";

const { executors, reportErrorMock, logWarningMock } = vi.hoisted(() => ({
	executors: [] as Array<{
		variables: Map<string, unknown>;
		callerDay?: unknown;
		execute: ReturnType<typeof vi.fn>;
		executeWithOutcome: ReturnType<typeof vi.fn>;
	}>,
	reportErrorMock: vi.fn(),
	logWarningMock: vi.fn(),
}));

vi.mock("../choiceExecutor", () => ({
	ChoiceExecutor: vi.fn(function ChoiceExecutor() {
		const executor = {
			variables: new Map<string, unknown>(),
			execute: vi.fn(async () => {}),
			executeWithOutcome: vi.fn(async () => ({ status: "success", effect: "changed" })),
		};
		executors.push(executor);
		return executor;
	}),
}));

vi.mock("../utils/errorUtils", async (importOriginal) => ({
	...(await importOriginal<typeof ErrorUtils>()),
	reportError: reportErrorMock,
}));

vi.mock("../logger/logManager", () => ({
	log: { logWarning: logWarningMock, logMessage: vi.fn(), logError: vi.fn() },
}));

import { registerQuickAddUri } from "./registerQuickAddUri";

const capture: IChoice = { id: "c1", name: "Inbox", type: "Capture", command: false };

function setup(enableUriCallbacks = false) {
	let handler!: (params: Record<string, string>) => Promise<void>;
	const warnIfAmbiguous = vi.fn();
	registerQuickAddUri(
		{
			app: { vault: { getName: () => "Vault" } },
			settings: { enableUriCallbacks },
			registerObsidianProtocolHandler: (_action: string, fn: typeof handler) => {
				handler = fn;
			},
		} as never,
		(name) => (name === capture.name ? capture : null),
		warnIfAmbiguous,
	);
	return { open: (params: Record<string, string>) => handler(params), warnIfAmbiguous };
}

beforeEach(() => {
	// Obsidian's renderer globals; callbacks open through window.open.
	vi.stubGlobal("window", globalThis);
	vi.stubGlobal("open", vi.fn());
	executors.length = 0;
	reportErrorMock.mockReset();
	logWarningMock.mockReset();
});

describe("obsidian://quickadd", () => {
	it("runs the named choice with its value- variables, never a reserved one", async () => {
		const { open, warnIfAmbiguous } = setup();

		await open({
			action: "quickadd",
			choice: "Inbox",
			"value-title": "Hello",
			"value-__qa.captureTargetFilePath": "Secret.md",
			"value-": "nameless",
			date: "ask",
		});

		expect(executors).toHaveLength(1);
		expect([...executors[0].variables]).toEqual([["title", "Hello"]]);
		expect(executors[0].callerDay).toBe("pick");
		expect(executors[0].execute).toHaveBeenCalledWith(capture);
		expect(warnIfAmbiguous).toHaveBeenCalledWith("Inbox");
	});

	it("reports an unknown choice and runs nothing", async () => {
		const { open } = setup();

		await open({ action: "quickadd", choice: "Nope" });

		expect(executors).toHaveLength(0);
		expect(reportErrorMock).toHaveBeenCalledWith(
			new Error("URI could not find any choice named 'Nope'"),
			"URI handler error",
		);
	});

	it("answers an unknown choice on the x-error callback when callbacks are on", async () => {
		const opened: string[] = [];
		vi.stubGlobal("open", (url: string) => opened.push(url));
		const { open } = setup(true);

		await open({ action: "quickadd", choice: "Nope", "x-error": "shortcuts://failed" });

		expect(executors).toHaveLength(0);
		expect(logWarningMock).toHaveBeenCalledWith("URI could not find any choice named 'Nope'");
		expect(opened).toHaveLength(1);
		expect(opened[0]).toContain("errorCode=choice-not-found");
	});

	it("runs a callback URI with the same value- variables", async () => {
		const { open } = setup(true);

		await open({
			action: "quickadd",
			choice: "Inbox",
			"value-title": "Hello",
			"value-__QA.dateOrigin": "2020-01-01",
			"x-success": "shortcuts://done",
		});

		expect([...executors[0].variables]).toEqual([["title", "Hello"]]);
		expect(executors[0].executeWithOutcome).toHaveBeenCalledWith(capture);
	});
});
