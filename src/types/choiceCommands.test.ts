import { describe, expect, it } from "vitest";
import {
	canOfferPickDayCommand,
	choiceCommandId,
	pickDayCommandId,
	pickDayCommandName,
	pickDaySettingName,
	shouldRegisterPickDayCommand,
} from "./choiceCommands";

describe("pick-a-day command", () => {
	it("is off by default and only registers when opted in", () => {
		expect(shouldRegisterPickDayCommand({ origin: undefined })).toBe(false);
		expect(
			shouldRegisterPickDayCommand({
				origin: { kind: "now" },
				enabled: false,
			}),
		).toBe(false);
		expect(
			shouldRegisterPickDayCommand({ origin: undefined, enabled: true }),
		).toBe(true);
		expect(
			shouldRegisterPickDayCommand({
				origin: { kind: "relative", offset: -1, unit: "days" },
				enabled: true,
			}),
		).toBe(true);
	});

	it("is never offered or registered for Ask each time", () => {
		expect(canOfferPickDayCommand({ kind: "ask" })).toBe(false);
		expect(canOfferPickDayCommand(undefined)).toBe(true);
		expect(
			shouldRegisterPickDayCommand({
				origin: { kind: "ask" },
				enabled: true,
			}),
		).toBe(false);
	});

	it("names the command after the choice", () => {
		expect(pickDayCommandName("Daily note")).toBe("Daily note (pick a day)");
		expect(pickDaySettingName("Daily note")).toBe(
			'Also add "Daily note (pick a day)"',
		);
	});

	it("keeps the existing choice command id so hotkeys stay bound", () => {
		const id = "weekly-review";
		expect(choiceCommandId(id)).toBe("choice:weekly-review");
		expect(pickDayCommandId(id)).toBe("choice:weekly-review:pick-day");
		expect(pickDayCommandId(id)).not.toBe(choiceCommandId(id));
	});
});
