import { beforeEach, describe, expect, it } from "vitest";
import { settingsStore } from "../settingsStore";
import InputPrompt from "./InputPrompt";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import GenericWideInputPrompt from "./GenericWideInputPrompt/GenericWideInputPrompt";
import NumberInputPrompt from "./NumberInputPrompt/NumberInputPrompt";
import SliderInputPrompt from "./SliderInputPrompt/SliderInputPrompt";

describe("InputPrompt factory", () => {
	beforeEach(() => {
		settingsStore.setState({ inputPrompt: "single-line" });
	});

	it("prefers multiline override over global single-line", () => {
		const prompt = new InputPrompt();
		expect(prompt.factory("multiline")).toBe(GenericWideInputPrompt);
	});

	it("uses global multiline when no override provided", () => {
		settingsStore.setState({ inputPrompt: "multi-line" });
		const prompt = new InputPrompt();
		expect(prompt.factory()).toBe(GenericWideInputPrompt);
	});

	it("uses single-line when no override and global single-line", () => {
		const prompt = new InputPrompt();
		expect(prompt.factory()).toBe(GenericInputPrompt);
	});

	it("uses number prompt for number override", () => {
		const prompt = new InputPrompt();
		expect(prompt.factory("number")).toBe(NumberInputPrompt);
	});

	it("uses slider prompt for slider override", () => {
		const prompt = new InputPrompt();
		expect(prompt.factory("slider")).toBe(SliderInputPrompt);
	});
});
