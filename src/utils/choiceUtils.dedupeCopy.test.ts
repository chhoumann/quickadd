import { describe, expect, it } from "vitest";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { dedupeChoicesById } from "./choiceUtils";

const capture = (name: string, id: string): IChoice => ({ id, name, type: "Capture", command: false }) as IChoice;
const folder = (name: string, id: string, choices: IChoice[]): IChoice =>
	({ id, name, type: "Multi", command: false, choices }) as unknown as IChoice;

describe("dedupeChoicesById on a copied folder", () => {
	it("keeps the children of a folder kept under a fresh id, under fresh ids of their own", () => {
		const out = dedupeChoicesById([
			folder("Projects", "f", [capture("Log", "c")]),
			folder("Projects (copy)", "f", [capture("Log", "c")]),
		]) as IMultiChoice[];

		expect(out.map((choice) => choice.name)).toEqual(["Projects", "Projects (copy)"]);
		expect(out[1]?.choices?.map((choice) => choice.name)).toEqual(["Log"]);
		expect(out[1]?.choices?.[0]?.id).not.toBe("c");
	});
});
