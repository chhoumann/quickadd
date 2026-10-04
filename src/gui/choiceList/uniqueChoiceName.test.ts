import { describe, expect, it } from "vitest";
import type IChoice from "../../types/choices/IChoice";
import { uniqueChoiceName } from "./uniqueChoiceName";

const choice = (name: string, type: IChoice["type"] = "Template"): IChoice =>
	({ id: name, name, type, command: false }) as unknown as IChoice;

const folder = (name: string, children: IChoice[]): IChoice =>
	({
		id: name,
		name,
		type: "Multi",
		command: false,
		collapsed: false,
		choices: children,
	}) as unknown as IChoice;

describe("uniqueChoiceName", () => {
	it("returns the base name when no collision exists", () => {
		expect(uniqueChoiceName("Log", [])).toBe("Log");
		expect(uniqueChoiceName("Log", [choice("Other")])).toBe("Log");
	});

	it("appends a counter when the base name is already taken", () => {
		expect(uniqueChoiceName("Log", [choice("Log")])).toBe("Log 2");
		expect(uniqueChoiceName("Log", [choice("Log"), choice("Log 2")])).toBe("Log 3");
	});

	it("checks names anywhere in the tree, including nested folders", () => {
		const existing = [folder("Folder", [choice("Log", "Capture")])];
		expect(uniqueChoiceName("Log", existing)).toBe("Log 2");
	});
});
