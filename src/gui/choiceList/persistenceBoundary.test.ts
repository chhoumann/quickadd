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
});
