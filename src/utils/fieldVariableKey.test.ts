import { describe, expect, it } from "vitest";
import {
	getFieldVariableKey,
	stripFieldVariableKeyPrefix,
} from "./fieldVariableKey";

describe("fieldVariableKey", () => {
	it("builds FIELD-prefixed runtime keys", () => {
		expect(getFieldVariableKey("People|folder:Contacts")).toBe(
			"FIELD:People|folder:Contacts",
		);
	});

	it("strips FIELD prefixes before field suggestion parsing", () => {
		expect(stripFieldVariableKeyPrefix("FIELD:People|folder:Contacts")).toBe(
			"People|folder:Contacts",
		);
	});

	it("leaves raw field suggestion inputs unchanged", () => {
		expect(stripFieldVariableKeyPrefix("People|folder:Contacts")).toBe(
			"People|folder:Contacts",
		);
	});
});
