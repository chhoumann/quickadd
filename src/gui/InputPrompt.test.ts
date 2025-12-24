import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../main", () => ({
	__esModule: true,
	default: class QuickAddMock {
		static instance = { settings: { inputPrompt: "single-line" } };
	},
}));

import InputPrompt from "./InputPrompt";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import GenericWideInputPrompt from "./GenericWideInputPrompt/GenericWideInputPrompt";
import QuickAdd from "../main";

describe("InputPrompt factory", () => {
	beforeEach(() => {
		QuickAdd.instance = {
			settings: { inputPrompt: "single-line" },
		} as any;
	});

	it("prefers multiline override over global single-line", () => {
		const prompt = new InputPrompt();
		expect(prompt.factory("multiline")).toBe(GenericWideInputPrompt);
	});

	it("uses global multiline when no override provided", () => {
		QuickAdd.instance = {
			settings: { inputPrompt: "multi-line" },
		} as any;
		const prompt = new InputPrompt();
		expect(prompt.factory()).toBe(GenericWideInputPrompt);
	});

	it("uses single-line when no override and global single-line", () => {
		const prompt = new InputPrompt();
		expect(prompt.factory()).toBe(GenericInputPrompt);
	});
});
