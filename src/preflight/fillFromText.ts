import type { JSONSchema } from "src/ai/tools/NormalizedTools";
import type { FieldRequirement } from "./fieldRequirements";

export type FillFromText = (
	text: string,
	fields: readonly FieldRequirement[],
) => Promise<Record<string, string>>;

const FILLABLE_TYPES = new Set<FieldRequirement["type"]>([
	"text",
	"textarea",
	"number",
	"dropdown",
	"date",
	"field-suggest",
	"suggester",
]);

/** The fields a model can fill as plain text; pickers of vault files stay manual. */
export function fillableFields(fields: readonly FieldRequirement[]): FieldRequirement[] {
	return fields.filter((field) => FILLABLE_TYPES.has(field.type) && !field.id.startsWith("__"));
}

/**
 * One string property per field, so the form's own inputs stay the single place
 * that parses and validates what gets written. Empty string means "the text does
 * not say".
 */
export function buildFillSchema(fields: readonly FieldRequirement[]): JSONSchema {
	const properties: Record<string, JSONSchema> = {};
	for (const field of fields) {
		const hints = [field.label !== field.id ? field.label : "", field.description ?? ""];
		if (field.type === "date") hints.push("a date as YYYY-MM-DD");
		if (field.type === "number") hints.push("a number");
		if (field.suggesterConfig?.multiSelect) hints.push("comma-separated values");
		if (field.pathContext) hints.push("used in a file name, so no : / \\ # ^ [ ] | characters");
		const options = field.displayOptions ?? field.options;
		const property: JSONSchema = { type: "string" };
		if (field.type === "dropdown" && options?.length) property.enum = [...options, ""];
		else if (options?.length) hints.push(`usually one of: ${options.slice(0, 30).join(", ")}`);
		const description = hints.filter(Boolean).join("; ");
		if (description) property.description = description;
		properties[field.id] = property;
	}
	return { type: "object", properties, required: Object.keys(properties) };
}
