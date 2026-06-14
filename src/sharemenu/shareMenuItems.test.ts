import { describe, expect, it, vi } from "vitest";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import {
	collectShareMenuItems,
	runChoiceWithSharedText,
	type SharedTextExecutor,
} from "./shareMenuItems";

let idCounter = 0;
function choice(
	name: string,
	type: IChoice["type"] = "Template",
	extra: Partial<IChoice> = {},
): IChoice {
	return { name, id: `choice-${idCounter++}`, type, command: false, ...extra };
}
function multi(name: string, children: IChoice[], extra: Partial<IMultiChoice> = {}): IMultiChoice {
	return {
		name,
		id: `multi-${idCounter++}`,
		type: "Multi",
		command: false,
		collapsed: false,
		choices: children,
		...extra,
	} as IMultiChoice;
}

describe("collectShareMenuItems", () => {
	it("selects only choices flagged showInShareMenu, including nested ones", () => {
		const shared = choice("Shared", "Macro", { showInShareMenu: true });
		const plain = choice("Plain", "Capture");
		const nested = choice("Nested", "Capture", { showInShareMenu: true });
		const folder = multi("Inbox", [nested, plain]);

		const items = collectShareMenuItems([shared, plain, folder]);

		expect(items.map((i) => i.title)).toEqual(["Shared", "Inbox / Nested"]);
		expect(items.map((i) => i.id)).toEqual([shared.id, nested.id]);
	});

	it("titles items by their full name path so duplicate names stay distinct", () => {
		const a = choice("Inbox", "Capture", { showInShareMenu: true });
		const b = choice("Inbox", "Capture", { showInShareMenu: true });
		const items = collectShareMenuItems([multi("Work", [a]), multi("Personal", [b])]);
		expect(items.map((i) => i.title)).toEqual(["Work / Inbox", "Personal / Inbox"]);
	});

	it("resolves the per-type default icon (or a per-choice override)", () => {
		const cap = choice("Cap", "Capture", { showInShareMenu: true });
		const mac = choice("Mac", "Macro", { showInShareMenu: true, icon: "rocket" });
		const items = collectShareMenuItems([cap, mac]);
		expect(items[0].icon).toBe("pencil"); // Capture default
		expect(items[1].icon).toBe("rocket"); // per-choice override wins
	});

	it("returns nothing when no choice opts in", () => {
		expect(collectShareMenuItems([choice("a"), multi("F", [choice("b")])])).toEqual([]);
	});
});

describe("runChoiceWithSharedText", () => {
	it("binds the shared text to the reserved `value` variable, then runs the choice", async () => {
		const order: string[] = [];
		const variables = new Map<string, unknown>();
		const target = choice("Target", "Capture");
		const executor: SharedTextExecutor = {
			variables,
			execute: vi.fn(async (c: IChoice) => {
				// value must be seeded BEFORE execute runs (so {{VALUE}} resolves without a prompt)
				order.push(`exec:${c.id}:${variables.get("value")}`);
			}),
		};

		await runChoiceWithSharedText(executor, target, "shared payload");

		expect(variables.get("value")).toBe("shared payload");
		expect(executor.execute).toHaveBeenCalledWith(target);
		expect(order).toEqual([`exec:${target.id}:shared payload`]);
	});
});
