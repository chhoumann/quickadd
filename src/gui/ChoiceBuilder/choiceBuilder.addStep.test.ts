import { App, Menu } from "obsidian";
import { fireEvent } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import type QuickAdd from "../../main";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import type IChoice from "../../types/choices/IChoice";
import { CaptureChoiceBuilder } from "./captureChoiceBuilder";

const plugin = { getTemplateFiles: () => [], settings: { choices: [] } } as unknown as QuickAdd;
const lastMenu = () =>
	(Menu as unknown as { lastShown: { items: { title: string; clickHandler: () => void }[] } }).lastShown;

describe("adding a step from a choice's builder", () => {
	it("saves the page, hands the choice on, and does not save over it when left", async () => {
		const events: string[] = [];
		const saved: IChoice[] = [];
		const choice = Object.assign(new CaptureChoice("Log"), { captureTo: "log.md" });
		const builder = new CaptureChoiceBuilder(
			new App(),
			choice,
			plugin,
			(edited) => {
				events.push("save");
				saved.push(edited);
			},
			(step) => events.push(`add ${step.type}`),
		);
		builder.display();

		await fireEvent.click(builder.containerEl.querySelector('[aria-label="Add a step"]') as HTMLElement);
		lastMenu().items.find((item) => item.title === "Run a script")?.clickHandler();
		expect(events).toEqual(["save", "add runScript"]);
		expect(saved[0]).toMatchObject({ id: choice.id, type: "Capture", captureTo: "log.md" });

		builder.hide();
		expect(events).toEqual(["save", "add runScript"]);
	});

	it("offers no step without someone to take the choice on", () => {
		const builder = new CaptureChoiceBuilder(new App(), new CaptureChoice("Log"), plugin, vi.fn());
		builder.display();
		expect(builder.containerEl.querySelector(".qaStepsList")).not.toBeNull();
		expect(builder.containerEl.querySelector('[aria-label="Add a step"]')).toBeNull();
	});
});
