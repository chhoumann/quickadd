/**
 * JSON Schema subset validator for tool inputs and structured output, limited to
 * what all three providers agree on. assertRegisterableSchema rejects any other
 * keyword at registration, so no constraint is silently dropped by a provider.
 * validateValue returns the first error so the loop can feed it back to the model.
 */
import type { JSONSchema, JSONSchemaType } from "./NormalizedTools";

// The only keywords this validator understands. Anything else is rejected at
// registration so it can't be a silently-unenforced constraint.
const SUPPORTED_KEYWORDS = new Set([
	"type",
	"properties",
	"required",
	"items",
	"enum",
	"const",
	"description",
	"title",
]);

const VALID_TYPES: ReadonlySet<string> = new Set([
	"object",
	"array",
	"string",
	"number",
	"integer",
	"boolean",
	"null",
]);

export class ToolSchemaError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ToolSchemaError";
	}
}

/**
 * Throws ToolSchemaError if `schema` uses a keyword outside the supported subset.
 * `where` is a human path for the error message (e.g. "inputSchema").
 */
export function assertRegisterableSchema(
	schema: JSONSchema,
	where = "schema",
): void {
	if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
		throw new ToolSchemaError(`${where} must be a JSON Schema object.`);
	}

	for (const keyword of Object.keys(schema)) {
		if (!SUPPORTED_KEYWORDS.has(keyword)) {
			throw new ToolSchemaError(
				`${where} uses unsupported JSON Schema keyword "${keyword}". QuickAdd tool schemas support only: ${[
					...SUPPORTED_KEYWORDS,
				].join(", ")}. (Constraints like pattern/minLength/additionalProperties/$ref/allOf/anyOf/format are rejected because at least one provider would silently drop them.)`,
			);
		}
	}

	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		for (const t of types) {
			if (!VALID_TYPES.has(t)) {
				throw new ToolSchemaError(`${where} has invalid type "${String(t)}".`);
			}
		}
	}

	if (schema.properties !== undefined) {
		if (
			schema.properties === null ||
			typeof schema.properties !== "object" ||
			Array.isArray(schema.properties)
		) {
			throw new ToolSchemaError(`${where}.properties must be an object.`);
		}
		for (const [key, sub] of Object.entries(schema.properties)) {
			assertRegisterableSchema(sub, `${where}.properties.${key}`);
		}
	}

	if (schema.required !== undefined) {
		if (
			!Array.isArray(schema.required) ||
			schema.required.some((r) => typeof r !== "string")
		) {
			throw new ToolSchemaError(`${where}.required must be an array of strings.`);
		}
	}

	if (schema.items !== undefined) {
		// Tuple-style `items` (an array of schemas) is NOT validated at runtime
		// (validateValue only applies a single items schema), so reject it at
		// registration rather than let the constraint be silently skipped.
		if (Array.isArray(schema.items)) {
			throw new ToolSchemaError(
				`${where}.items as an array (tuple validation) is not supported in QuickAdd's schema subset.`,
			);
		}
		assertRegisterableSchema(schema.items, `${where}.items`);
	}

	if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
		throw new ToolSchemaError(`${where}.enum must be an array.`);
	}
}

function typeOfValue(value: unknown): JSONSchemaType {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "number") {
		return Number.isInteger(value) ? "integer" : "number";
	}
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "string") return "string";
	return "object";
}

function matchesType(value: unknown, expected: JSONSchemaType): boolean {
	const actual = typeOfValue(value);
	if (actual === expected) return true;
	// JSON has one number type; an integer value satisfies "number".
	if (expected === "number" && actual === "integer") return true;
	// typeOfValue reports a non-integer as "number", so it fails "integer".
	return false;
}

/**
 * Validate `value` against the subset schema. Returns the first error message, or
 * null when valid. `path` is used for readable error messages.
 */
export function validateValue(
	value: unknown,
	schema: JSONSchema,
	path = "$",
): string | null {
	if (schema.type !== undefined) {
		const types = Array.isArray(schema.type) ? schema.type : [schema.type];
		if (!types.some((t) => matchesType(value, t))) {
			return `${path}: expected ${types.join(" | ")}, got ${typeOfValue(value)}`;
		}
	}

	if (Array.isArray(schema.enum)) {
		const ok = schema.enum.some((e) => deepEqual(e, value));
		if (!ok) return `${path}: value is not one of the allowed enum values`;
	}

	if ("const" in schema && !deepEqual(schema.const, value)) {
		return `${path}: value does not equal the required const`;
	}

	if (typeOfValue(value) === "object") {
		const obj = value as Record<string, unknown>;
		if (Array.isArray(schema.required)) {
			for (const key of schema.required) {
				// own-property check: `key in obj` would match inherited props
				// (e.g. a required "toString" would pass even when absent).
				if (!Object.prototype.hasOwnProperty.call(obj, key))
					return `${path}.${key}: required property is missing`;
			}
		}
		if (schema.properties) {
			for (const [key, sub] of Object.entries(schema.properties)) {
				if (key in obj) {
					const err = validateValue(obj[key], sub, `${path}.${key}`);
					if (err) return err;
				}
			}
		}
	}

	if (typeOfValue(value) === "array" && schema.items && !Array.isArray(schema.items)) {
		const arr = value as unknown[];
		for (let i = 0; i < arr.length; i++) {
			const err = validateValue(arr[i], schema.items, `${path}[${i}]`);
			if (err) return err;
		}
	}

	return null;
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a === null || b === null) return a === b;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
	}
	if (typeof a === "object" && typeof b === "object") {
		const ka = Object.keys(a);
		const kb = Object.keys(b);
		if (ka.length !== kb.length) return false;
		return ka.every((k) =>
			deepEqual(
				(a as Record<string, unknown>)[k],
				(b as Record<string, unknown>)[k],
			),
		);
	}
	return false;
}
