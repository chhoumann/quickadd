import { describe, expect, it } from "vitest";
import { NLDParser } from "./NLDParser";

describe("NLDParser", () => {
	it.each([
		{
			input: "March 13, 2022 at 2:30 AM UTC",
			expected: "2022-03-13T02:30:00.000Z",
		},
		{
			input: "March 27, 2022 at 2:30 AM UTC",
			expected: "2022-03-27T02:30:00.000Z",
		},
	])("parses $input independently of the host DST gap", ({ input, expected }) => {
		expect(NLDParser.getParsedDate(input)?.toISOString()).toBe(expected);
	});
});
