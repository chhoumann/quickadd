import { describe, expect, it } from "vitest";
import {
	decodeMultiSelectValues,
	encodeMultiSelectValues,
} from "./multiSelectEncoding";

describe("multi-select value encoding", () => {
	it("round-trips selected values that contain commas", () => {
		const values = ["Doe, Jane", "Alice"];

		expect(decodeMultiSelectValues(encodeMultiSelectValues(values))).toEqual(
			values,
		);
	});

	it("ignores ordinary visible input strings", () => {
		expect(decodeMultiSelectValues("Doe, Jane, Alice")).toBeNull();
	});
});
