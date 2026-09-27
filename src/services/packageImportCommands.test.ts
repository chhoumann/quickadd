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

		// The import result lists the folder's inline child ("t2") as added too.
		syncImportedChoiceCommands(reg, [], {
			updatedChoices: [top, folder],
			addedChoiceIds: ["t1", "m1", "t2"],
			overwrittenChoiceIds: [],
		});

		// The folder itself is registered once; addCommandForChoice (main.ts)
		// walks a Multi's children, so the nested choice is not registered again.
		expect(reg.add.mock.calls.map(([c]) => (c as IChoice).id)).toEqual(["t1", "m1"]);
		expect(reg.remove).not.toHaveBeenCalled();
	});

	it("skips a grandchild whose folder is in the result, but not one whose folder is not", () => {
		const grandchild = choice("g1", "Grandchild");
		const inner = multi("m2", "Inner", [grandchild]);
		const outer = multi("m1", "Outer", [inner]);
		const loose = choice("t9", "Loose");
		const keptFolder = multi("m3", "Kept", [loose]);
		const reg = registrar();

		// m1 and its whole subtree were imported; m3 already existed and only
		// its child t9 was (re)imported, so t9 must be registered on its own.
		syncImportedChoiceCommands(reg, [multi("m3", "Kept", [choice("t9", "Loose v1")])], {
			updatedChoices: [outer, keptFolder],
			addedChoiceIds: ["m1", "m2", "g1"],
			overwrittenChoiceIds: ["t9"],
		});

		expect(reg.add.mock.calls.map(([c]) => (c as IChoice).id)).toEqual(["t9", "m1"]);
		expect(reg.remove).toHaveBeenCalledTimes(1);
		expect((reg.remove.mock.calls[0][0] as IChoice).name).toBe("Loose v1");
	});

	it("does not drop a re-added child's command while overwriting its folder", () => {
		const oldChild = choice("c1", "Child v1");
		const previous = multi("m1", "Folder", [oldChild]);
		const newChild = choice("c1", "Child v2");
		const replacement = multi("m1", "Folder", [newChild]);
		const reg = registrar();

		// Both the folder and its inline child are reported as overwritten.
		// Removing the child after the folder re-registered its subtree would
		// unregister the fresh command, so only the folder is processed.
		syncImportedChoiceCommands(reg, [previous], {
			updatedChoices: [replacement],
			addedChoiceIds: [],
			overwrittenChoiceIds: ["m1", "c1"],
		});

		expect(reg.remove).toHaveBeenCalledTimes(1);
		expect(reg.remove.mock.calls[0][0]).toBe(previous);
		expect(reg.add).toHaveBeenCalledTimes(1);
		expect(reg.add.mock.calls[0][0]).toBe(replacement);
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
