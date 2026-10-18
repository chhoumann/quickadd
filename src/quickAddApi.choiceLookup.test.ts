import { createChoiceExecutor } from "../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { QuickAddApi } from "./quickAddApi";
import type QuickAdd from "./main";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import type IChoice from "./types/choices/IChoice";
import type IMultiChoice from "./types/choices/IMultiChoice";
import { reportError } from "./utils/errorUtils";
import type * as ErrorUtils from "./utils/errorUtils";

vi.mock("./quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: {},
	QuickAddSettingsTab: class {},
}));

vi.mock("./formatters/completeFormatter", () => ({
	CompleteFormatter: class CompleteFormatterMock {},
}));

vi.mock("./utils/errorUtils", async (importOriginal) => ({
	...(await importOriginal<typeof ErrorUtils>()),
	reportError: vi.fn(),
}));

function leaf(id: string, name: string, type: IChoice["type"] = "Capture"): IChoice {
	return { id, name, type, command: false, captureTo: "Inbox.md" } as IChoice;
}

function folder(id: string, name: string, choices: IChoice[]): IMultiChoice {
	return { id, name, type: "Multi", command: false, choices, collapsed: false };
}

describe("QuickAddApi choice lookup", () => {
	const app = {} as App;
	let executed: IChoice[];
	let choiceExecutor: IChoiceExecutor;
	let choices: IChoice[];

	const api = () =>
		QuickAddApi.GetApi(app, { settings: { choices } } as unknown as QuickAdd, choiceExecutor);

	beforeEach(() => {
		vi.mocked(reportError).mockClear();
		executed = [];
		choiceExecutor = {
			...createChoiceExecutor(),
			execute: vi.fn(async (choice: IChoice) => {
				executed.push(choice);
			}),
			variables: new Map<string, unknown>(),
			consumeAbortSignal: vi.fn().mockReturnValue(null),
		};
		choices = [
			leaf("inbox", "Log"),
			folder("podcasts", "Podcasts", [
				folder("shows", "Shows", [leaf("episode", "Log", "Macro")]),
			]),
		];
	});

	describe("getChoice", () => {
		// toEqual also proves no stored setting (captureTo) crosses the boundary.
		it("describes a nested choice by id with its folder path", () => {
			expect(api().getChoice({ id: "episode" })).toEqual({
				id: "episode",
				name: "Log",
				type: "Macro",
				path: ["Podcasts", "Shows", "Log"],
			});
		});

		it("takes the first choice in list order when names repeat", () => {
			expect(api().getChoice("Log")).toEqual({
				id: "inbox",
				name: "Log",
				type: "Capture",
				path: ["Log"],
			});
		});

		it("describes a folder too", () => {
			expect(api().getChoice("Podcasts")).toMatchObject({ type: "Multi", path: ["Podcasts"] });
		});

		it.each([
			["an unknown id", { id: "gone" }],
			["an unknown name", "Gone"],
			["an id passed as a name", "inbox"],
			["null from a script", null],
			["an object without an id", {}],
		])("returns null for %s without a notice", (_label, ref) => {
			expect(api().getChoice(ref as never)).toBeNull();
			expect(reportError).not.toHaveBeenCalled();
		});
	});

	describe("executeChoice by id", () => {
		it("runs the choice with that id after a rename", async () => {
			const renamed = leaf("episode", "Episode timestamp", "Macro");
			choices = [leaf("inbox", "Log"), folder("podcasts", "Podcasts", [renamed])];

			await api().executeChoice({ id: "episode" }, { timestamp: "00:12:34" });

			expect(executed).toEqual([renamed]);
		});

		it("runs exactly that one of two choices sharing a name", async () => {
			await api().executeChoice({ id: "episode" });

			expect(executed.map((choice) => choice.id)).toEqual(["episode"]);
		});

		it("still runs a name as the first match", async () => {
			await api().executeChoice("Log");

			expect(executed.map((choice) => choice.id)).toEqual(["inbox"]);
		});

		it("reports an unknown id as a missing choice and resolves", async () => {
			await expect(api().executeChoice({ id: "gone" })).resolves.toBeUndefined();

			expect(executed).toEqual([]);
			expect(reportError).toHaveBeenCalledTimes(1);
			const [error] = vi.mocked(reportError).mock.calls[0];
			expect((error as Error).message).toBe("Choice with id 'gone' not found");
		});
	});
});
