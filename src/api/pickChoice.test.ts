// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, Notice } from "obsidian";
import type QuickAdd from "../main";
import { ChoiceExecutor } from "../choiceExecutor";
import { UserCancelError } from "../errors/UserCancelError";
import ChoiceSuggester, { BACK_CHOICE_ID } from "../gui/suggesters/choiceSuggester";
import { NO_CHOICES_NOTICE } from "../gui/suggesters/openChoiceLauncher";
import { settingsStore } from "../settingsStore";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { pickChoice } from "./choiceApi";

function leaf(id: string, name: string): IChoice {
	return { id, name, type: "Capture", command: false } as IChoice;
}

function folder(id: string, name: string, choices: IChoice[]): IMultiChoice {
	return { id, name, type: "Multi", command: false, choices, collapsed: false };
}

const pressed = new MouseEvent("click");
const match = { score: 0, matches: [] };

describe("pickChoice", () => {
	let opened: ChoiceSuggester[];
	let ran: string[];
	let timestamp: IChoice;
	let podcasts: IMultiChoice;
	let inbox: IChoice;

	const plugin = (choices: IChoice[]) =>
		({ app: new App(), settings: { choices } }) as unknown as QuickAdd;
	const current = () => opened[opened.length - 1];
	const choose = (item: IChoice) => current().selectSuggestion({ item, match }, pressed);

	beforeEach(() => {
		opened = [];
		vi.spyOn(ChoiceSuggester.prototype, "open").mockImplementation(function (this: ChoiceSuggester) {
			opened.push(this);
		});
		ran = [];
		vi.spyOn(ChoiceExecutor.prototype, "execute").mockImplementation(async (choice) => {
			ran.push(choice.name);
		});
		vi.spyOn(ChoiceExecutor.prototype, "executeWithFocusedProperty").mockImplementation(async (choice) => {
			ran.push(choice.name);
		});
		(Notice as unknown as { instances: unknown[] }).instances = [];
		settingsStore.setState({ searchNestedChoices: false });

		timestamp = leaf("timestamp", "Log timestamp");
		podcasts = folder("podcasts", "Podcasts", [timestamp]);
		inbox = leaf("inbox", "Inbox");
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("resolves the picked choice and runs nothing", async () => {
		const picked = pickChoice(plugin([inbox, podcasts]));

		choose(inbox);

		await expect(picked).resolves.toEqual({
			id: "inbox",
			name: "Inbox",
			type: "Capture",
			path: ["Inbox"],
		});
		expect(ran).toEqual([]);
	});

	it("keeps pick mode through a folder and Back", async () => {
		const picked = pickChoice(plugin([inbox, podcasts]));

		choose(podcasts);
		const back = current().getItems().find((item) => item.id === BACK_CHOICE_ID);
		choose(back as IChoice);
		choose(podcasts);
		choose(timestamp);

		await expect(picked).resolves.toMatchObject({
			id: "timestamp",
			path: ["Podcasts", "Log timestamp"],
		});
		expect(opened).toHaveLength(4);
		expect(ran).toEqual([]);
	});

	it("searches nested choices even with Search nested choices off", () => {
		void pickChoice(plugin([inbox, podcasts]));

		const found = current().getSuggestions("timestamp").map((result) => result.item);

		expect(found).toEqual([timestamp]);
	});

	it("rejects with a cancellation when the picker is dismissed", async () => {
		const picked = pickChoice(plugin([inbox, podcasts]));

		current().close();

		await expect(picked).rejects.toBeInstanceOf(UserCancelError);
		expect(ran).toEqual([]);
	});

	it("shows the launcher's notice and opens nothing when there are no choices", async () => {
		await expect(pickChoice(plugin([]))).rejects.toBeInstanceOf(UserCancelError);

		expect(opened).toEqual([]);
		expect(
			(Notice as unknown as { instances: Array<{ message: string }> }).instances.map(
				(notice) => notice.message,
			),
		).toEqual([NO_CHOICES_NOTICE]);
	});

	it("shows the caller's placeholder", () => {
		void pickChoice(plugin([inbox]), { placeholder: "Pick a capture choice" });

		expect(current().inputEl.placeholder).toBe("Pick a capture choice");
	});
});
