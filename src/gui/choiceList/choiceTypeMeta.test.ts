import { describe, expect, it } from "vitest";
import type IChoice from "../../types/choices/IChoice";
import { defaultChoiceName, uniqueDefaultChoiceName } from "./choiceTypeMeta";

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

describe("uniqueDefaultChoiceName", () => {
	it("returns the base name when no collision exists", () => {
		expect(uniqueDefaultChoiceName("Template", [])).toBe("New template");
		expect(uniqueDefaultChoiceName("Template", [choice("Other")])).toBe(
			"New template",
		);
	});

	it("appends a counter when the base name is already taken", () => {
		const existing = [choice("New template")];
		expect(uniqueDefaultChoiceName("Template", existing)).toBe("New template 2");
		expect(
			uniqueDefaultChoiceName("Template", [
				choice("New template"),
				choice("New template 2"),
			]),
		).toBe("New template 3");
	});

	it("checks names anywhere in the tree, including nested folders", () => {
		const existing = [folder("Folder", [choice("New template")])];
		expect(uniqueDefaultChoiceName("Template", existing)).toBe("New template 2");
	});

	it("disambiguates every choice type independently", () => {
		for (const type of ["Template", "Capture", "Macro", "Multi"] as const) {
			const base = defaultChoiceName(type);
			expect(uniqueDefaultChoiceName(type, [choice(base, type)])).toBe(
				`${base} 2`,
			);
		}
	});
});
