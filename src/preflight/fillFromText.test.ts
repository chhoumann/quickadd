import { describe, expect, it } from "vitest";
import { buildFillSchema, fillableFields } from "./fillFromText";
import type { FieldRequirement } from "./fieldRequirements";

const field = (overrides: Partial<FieldRequirement> & Pick<FieldRequirement, "id" | "type">): FieldRequirement => ({
	label: overrides.id,
	...overrides,
});

describe("fillFromText", () => {
	it("leaves vault pickers and internal inputs to the user", () => {
		const fields = [
			field({ id: "title", type: "text" }),
			field({ id: "FILE:project", type: "file-picker" }),
			field({ id: "__qa.dateOrigin", type: "date" }),
			field({ id: "rating", type: "slider" }),
		];

		expect(fillableFields(fields).map((f) => f.id)).toEqual(["title"]);
	});

	it("asks for one string per field, with an empty answer allowed for dropdowns", () => {
		const schema = buildFillSchema([
			field({ id: "title", type: "text" }),
			field({ id: "status", type: "dropdown", options: ["todo", "done"] }),
			field({ id: "due", type: "date", dateFormat: "YYYY-MM-DD" }),
			field({ id: "value", type: "text", label: "Enter value" }),
		]);

		expect(schema).toEqual({
			type: "object",
			required: ["title", "status", "due", "value"],
			properties: {
				title: { type: "string" },
				status: { type: "string", enum: ["todo", "done", ""] },
				due: { type: "string", description: "a date as YYYY-MM-DD" },
				value: { type: "string", description: "Enter value" },
			},
		});
	});
});
