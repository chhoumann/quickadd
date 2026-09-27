import { describe, expect, it, vi } from "vitest";
import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import {
	syncImportedChoiceCommands,
	type ChoiceCommandRegistrar,
} from "./packageImportCommands";

function choice(id: string, name: string, command = true): IChoice {
	return { id, name, type: "Template", command } as IChoice;
}

function multi(id: string, name: string, children: IChoice[]): IMultiChoice {
	return {
		id,
		name,
		type: "Multi",
		command: false,
		choices: children,
		collapsed: false,
	} as IMultiChoice;
}

function registrar(): ChoiceCommandRegistrar & {
	add: ReturnType<typeof vi.fn>;
	remove: ReturnType<typeof vi.fn>;
} {
	const add = vi.fn();
	const remove = vi.fn();
	return {
		add,
		remove,
		addCommandForChoice: add,
		removeCommandForChoice: remove,
	};
}

describe("syncImportedChoiceCommands", () => {
	it("registers commands for added choices, including ones nested in an imported folder", () => {
		const nested = choice("t2", "Nested");
		const folder = multi("m1", "Folder", [nested]);
		const top = choice("t1", "Top");
		const reg = registrar();

		syncImportedChoiceCommands(reg, [], {
			updatedChoices: [top, folder],
			addedChoiceIds: ["t1", "m1"],
			overwrittenChoiceIds: [],
		});

		// The folder itself is registered once; addCommandForChoice (main.ts)
		// walks a Multi's children, so the nested choice is not registered twice.
		expect(reg.add.mock.calls.map(([c]) => (c as IChoice).id)).toEqual(["t1", "m1"]);
		expect(reg.remove).not.toHaveBeenCalled();
	});

	it("drops the previous subtree before registering an overwritten choice", () => {
		const oldChild = choice("c-old", "Old child");
		const previous = multi("m1", "Folder", [oldChild]);
		const replacement = multi("m1", "Folder renamed", [choice("c-new", "New child")]);
		const reg = registrar();

		syncImportedChoiceCommands(reg, [previous], {
			updatedChoices: [replacement],
			addedChoiceIds: [],
			overwrittenChoiceIds: ["m1"],
		});

		expect(reg.remove).toHaveBeenCalledTimes(1);
		const [removed, options] = reg.remove.mock.calls[0] as [IChoice, { recursive?: boolean }];
		expect(removed).toBe(previous);
		expect(options).toEqual({ recursive: true });
		expect(reg.add).toHaveBeenCalledTimes(1);
		expect((reg.add.mock.calls[0][0] as IChoice).name).toBe("Folder renamed");
		// Removal must precede registration so a renamed choice leaves no stale entry.
		expect(reg.remove.mock.invocationCallOrder[0]).toBeLessThan(
			reg.add.mock.invocationCallOrder[0],
		);
	});

	it("finds the previous choice when it lived inside a folder", () => {
		const target = choice("t1", "Inside");
		const previous = [multi("m1", "Folder", [target])];
		const replacement = choice("t1", "Inside v2");
		const reg = registrar();

		syncImportedChoiceCommands(reg, previous, {
			updatedChoices: [multi("m1", "Folder", [replacement])],
			addedChoiceIds: [],
			overwrittenChoiceIds: ["t1"],
		});

		expect(reg.remove.mock.calls[0][0]).toBe(target);
		expect(reg.add.mock.calls[0][0]).toBe(replacement);
	});

	it("ignores skipped choices and ids missing from the result", () => {
		const reg = registrar();
		syncImportedChoiceCommands(reg, [choice("keep", "Keep")], {
			updatedChoices: [choice("keep", "Keep")],
			addedChoiceIds: ["ghost"],
			overwrittenChoiceIds: [],
		});
		expect(reg.add).not.toHaveBeenCalled();
		expect(reg.remove).not.toHaveBeenCalled();
	});
});
