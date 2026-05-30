import { describe, expect, it } from "vitest";
import { createChoicesBuffer } from "./persistenceBoundary.svelte";
import type IChoice from "../../types/choices/IChoice";

const choice = (name: string): IChoice =>
	({ id: name, name, type: "Template", command: false }) as unknown as IChoice;

describe("choices persistence snapshot boundary", () => {
	it("snapshot is a plain, JSON-serializable clone of the current choices", () => {
		const buf = createChoicesBuffer([choice("A")]);
		buf.add(choice("B"));

		const snap = buf.snapshot();
		expect(snap.map((c) => c.name)).toEqual(["A", "B"]);
		// Full JSON round-trip is identity-equal -> no Proxy artifacts that would
		// corrupt data.json / zustand setState.
		expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
	});

	it("snapshot does NOT alias the reactive source (later mutations don't leak in)", () => {
		const buf = createChoicesBuffer([choice("A")]);
		const snap = buf.snapshot();

		buf.renameFirst("Renamed");

		// The captured snapshot is a detached clone, unaffected by later source mutation.
		expect(snap[0].name).toBe("A");
		expect(buf.value[0].name).toBe("Renamed");
	});

	it("snapshot deep-detaches NESTED branches (a later nested mutation doesn't leak in)", () => {
		// The actual #1249 data-loss mechanism is at depth: a Conditional command's
		// then/else branch lives several levels down a Macro choice. A shallow clone
		// would alias these and silently drop in-component edits.
		const macroWithConditional = (): IChoice =>
			({
				id: "macro",
				name: "Macro",
				type: "Macro",
				command: false,
				macro: {
					id: "macro-macro",
					name: "Macro",
					commands: [
						{
							id: "cond",
							name: "If",
							type: "Conditional",
							thenCommands: [] as unknown[],
							elseCommands: [] as unknown[],
						},
					],
				},
			}) as unknown as IChoice;

		const buf = createChoicesBuffer([macroWithConditional()]);
		const snap = buf.snapshot();

		// Mutate a deeply-nested Then branch through the live reactive proxy AFTER
		// snapshotting.
		const liveCond = (
			buf.value[0] as unknown as {
				macro: { commands: Array<{ thenCommands: unknown[] }> };
			}
		).macro.commands[0];
		liveCond.thenCommands.push({ id: "wait", name: "Wait", type: "Wait" });

		const snappedCond = (
			snap[0] as unknown as {
				macro: { commands: Array<{ thenCommands: unknown[] }> };
			}
		).macro.commands[0];
		// The detached snapshot's nested branch is unaffected...
		expect(snappedCond.thenCommands).toEqual([]);
		// ...while the live source did change.
		expect(liveCond.thenCommands).toHaveLength(1);
	});
});
