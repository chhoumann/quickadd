import { getFrontMatterInfo, parseYaml, stringifyYaml } from "obsidian";
import { PROPERTY_REGEX } from "../constants";
import type { PropertyCapture } from "../types/choices/ICaptureChoice";

export type CapturePropertyValue = string | number | boolean | string[];

export function validatePropertyName(input: string): string {
	const key = input.trim();
	if (!key || /[\r\n\0]/.test(key) || key === "__proto__") {
		throw new Error("Property name must be nonempty and contain no line breaks or unsafe keys.");
	}
	return key;
}

/** Whether a Capture format includes `{{PROPERTY}}` (case-insensitive). */
export function formatContainsPropertyToken(format: string): boolean {
	return PROPERTY_REGEX.test(format);
}

/**
 * String form of a property's current value for `{{PROPERTY}}` expansion.
 * Lists become one item per line (so captureListItems round-trips). Items that
 * already contain a line break abort — inventing extra items would be wrong.
 */
export function stringifyPropertyTokenValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (Array.isArray(value)) {
		if (!value.every((item): item is string => typeof item === "string")) {
			throw new Error("{{PROPERTY}} only expands lists of text.");
		}
		if (value.some((item) => /[\r\n]/.test(item))) {
			throw new Error(
				"{{PROPERTY}} cannot expand a list item that contains a line break. Return a rewritten array from an inline script instead.",
			);
		}
		return value.join("\n");
	}
	if (typeof value === "string" || typeof value === "boolean") return String(value);
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	throw new Error("{{PROPERTY}} only expands text, finite numbers, checkboxes, and lists of text.");
}

/** Variable keys seeded for property Captures. Reserved while that Capture runs. */
export const PROPERTY_CAPTURE_SEED_KEYS = [
	"propertyKey",
	"propertyValue",
	"list",
] as const;

export type PropertyCaptureSeedSnapshot = Array<{
	key: (typeof PROPERTY_CAPTURE_SEED_KEYS)[number];
	present: boolean;
	value: unknown;
}>;

/** Snapshot the seed keys so a Capture can restore the shared executor map. */
export function snapshotPropertyCaptureSeeds(
	variables: Map<string, unknown>,
): PropertyCaptureSeedSnapshot {
	return PROPERTY_CAPTURE_SEED_KEYS.map((key) => ({
		key,
		present: variables.has(key),
		value: variables.get(key),
	}));
}

/** Restore seed keys after a property Capture (Macro-safe shared executor). */
export function restorePropertyCaptureSeeds(
	variables: Map<string, unknown>,
	snapshot: PropertyCaptureSeedSnapshot,
): void {
	for (const entry of snapshot) {
		if (entry.present) variables.set(entry.key, entry.value);
		else variables.delete(entry.key);
	}
}

/**
 * Seeds format/script variables with a frozen snapshot of the destination
 * property before `formatPropertyValue` runs (#1748 Slice 1).
 *
 * Throws when a seed key already holds a concrete value (for example from
 * `{{VALUE:list}}`), so the snapshot cannot silently replace a user answer.
 * Callers must {@link restorePropertyCaptureSeeds} in a `finally` so a later
 * property Capture in the same Macro can seed again.
 */
export function seedPropertyCaptureVariables(
	variables: Map<string, unknown>,
	key: string,
	existing: unknown,
): void {
	for (const seedKey of PROPERTY_CAPTURE_SEED_KEYS) {
		if (!variables.has(seedKey) || variables.get(seedKey) === undefined) continue;
		throw new Error(
			`Property Capture cannot seed '${seedKey}' because that variable is already set. Rename your {{VALUE:${seedKey}}} prompt (or other writer of this key) so it does not collide with the property snapshot.`,
		);
	}
	let propertyValue: CapturePropertyValue | undefined;
	if (existing !== undefined && existing !== null) {
		propertyValue = propertyValueFromExisting(existing, key);
	}
	variables.set("propertyKey", key);
	variables.set("propertyValue", propertyValue);
	variables.set("list", Array.isArray(propertyValue) ? [...propertyValue] : []);
}

function propertyValueFromExisting(value: unknown, key: string): CapturePropertyValue {
	if (typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) {
		return [...value];
	}
	throw new Error(`Property '${key}' supports text, finite numbers, checkboxes, and lists of text only.`);
}

export function resolveCapturePropertyKey(frontmatter: Record<string, unknown>, requested: string): string {
	if (Object.prototype.hasOwnProperty.call(frontmatter, requested)) return requested;
	const matches = Object.keys(frontmatter).filter((key) => key.trim().toLowerCase() === requested.trim().toLowerCase());
	if (matches.length > 1) throw new Error(`Property '${requested}' matches multiple properties in the target note.`);
	return matches[0] ?? requested;
}

/**
 * Turns captured text into list items: one per non-blank line, trimmed. A single
 * line is one item, so commas stay inside it. Newline is the boundary because it
 * is what Enter means in Obsidian's own List property editor.
 */
export function captureListItems(value: string): string[] {
	return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
}

/** Whether an Add to list value contributes no items, so the capture should leave the note alone. */
export function isEmptyCaptureListValue(value: unknown): boolean {
	if (typeof value === "string") return captureListItems(value).length === 0;
	return Array.isArray(value) && value.length === 0;
}

function propertyValue(value: unknown, key: string): CapturePropertyValue {
	if (typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) return [...value];
	throw new Error(`Property '${key}' supports text, finite numbers, checkboxes, and lists of text only.`);
}

type PropertyType = "text" | "number" | "checkbox" | "list" | "date" | "datetime";

function propertyType(type: string | null, key: string): PropertyType | null {
	if (type === null && ["tags", "aliases", "cssclasses"].includes(key.toLowerCase())) return "list";
	if (type === null) return null;
	switch (type.toLowerCase()) {
		case "text": return "text";
		case "number": return "number";
		case "checkbox": case "boolean": return "checkbox";
		case "list": case "multitext": case "tags": case "aliases": return "list";
		case "date": return "date";
		case "datetime": return "datetime";
		default: throw new Error(`Property '${key}' has unsupported type '${type}'.`);
	}
}

/** Whether the capture writes list items, known before the format runs. */
export function capturesListItems(args: {
	key: string;
	action: PropertyCapture["action"];
	registeredType: string | null;
	existing: unknown;
}): boolean {
	if (args.action === "addToList") return true;
	const type = propertyType(args.registeredType, args.key);
	return type === "list" || (type === null && Array.isArray(args.existing));
}

function inferType(value: CapturePropertyValue): PropertyType {
	if (Array.isArray(value)) return "list";
	if (typeof value === "boolean") return "checkbox";
	if (typeof value === "number") return "number";
	return "text";
}

function validateType(value: CapturePropertyValue, type: PropertyType, key: string): void {
	const actual = inferType(value);
	if (type === "date" || type === "datetime") {
		const pattern = type === "date"
			? /^\d{4}-\d{2}-\d{2}$/
			: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;
		if (typeof value === "string" && (value === "" || (
			pattern.test(value) && Number.isFinite(Date.parse(value)) &&
			new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10)
		))) return;
	} else if (actual === type) {
		return;
	}
	throw new Error(`Property '${key}' requires ${type}; the capture is ${actual}. Use a matching typed VALUE token or value.`);
}

export function planPropertyUpdate(args: {
	frontmatter: Record<string, unknown>;
	key: string;
	value: unknown;
	config: Pick<PropertyCapture, "action" | "createIfMissing">;
	registeredType: string | null;
	/**
	 * When the Capture format contained `{{PROPERTY}}`, the formatted value is
	 * already the full composed result. List writes always replace (first
	 * occurrence in the composed format wins); Add's append path is skipped.
	 */
	compose?: boolean;
}): CapturePropertyValue {
	const { frontmatter, config } = args;
	const key = resolveCapturePropertyKey(frontmatter, args.key);
	const exists = Object.prototype.hasOwnProperty.call(frontmatter, key);
	if (!exists && !config.createIfMissing) {
		throw new Error(`Property '${key}' is missing. Enable 'Create property if missing' to add it.`);
	}
	const existing = exists ? frontmatter[key] : undefined;
	const captured = propertyValue(args.value, key);
	const current = existing == null ? null : propertyValue(existing, key);
	const type = propertyType(args.registeredType, key) ?? (current === null ? null : inferType(current));
	const lines = typeof captured === "string" ? captureListItems(captured) : null;
	if (config.action === "addToList") {
		if (current !== null && !Array.isArray(current)) {
			throw new Error(`Property '${key}' is ${inferType(current)}. 'Add to list' requires a list.`);
		}
		if (type !== null && type !== "list") {
			throw new Error(`Property '${key}' is ${type}. 'Add to list' requires a list.`);
		}
		const items = lines ?? captured;
		if (!Array.isArray(items)) throw new Error(`Property '${key}' requires text or a list of text to add.`);
		if (items.length === 0) return current ?? [];
		// Token present ⇒ write the composed list as-is (first occurrence wins).
		if (args.compose) return [...new Set(items)];
		return [...new Set([...(current ?? []), ...items])];
	}
	if (type === "list" && current !== null && !Array.isArray(current)) {
		throw new Error(`Property '${key}' contains ${inferType(current)}. Set a list only after correcting the existing property to a list.`);
	}
	// Several lines into a typeless key usually mean a list, and line count is not
	// a type signal, so guessing text here is both likely wrong and expensive: it
	// registers the key as Text vault-wide and blocks every later Add to list.
	if (type === null && lines !== null && lines.length > 1) {
		throw new Error(`Property '${key}' has no type yet, so ${lines.length} lines could be one text value or a list. Use 'Add to list' to write them as list items, or set the property's type in Obsidian first - Text keeps the lines as one value.`);
	}
	const next = type === "list" ? lines ?? captured : captured;
	if (type !== null) validateType(next, type, key);
	return Array.isArray(next) ? [...new Set(next)] : next;
}

export function readCaptureFrontmatter(content: string): Record<string, unknown> {
	const info = getFrontMatterInfo(content);
	if (!info.exists || !info.frontmatter.trim()) return {};
	const parsed: unknown = parseYaml(info.frontmatter);
	if (parsed === null) return {};
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("The capture target's frontmatter must be a property mapping.");
	}
	return Object.fromEntries(Object.entries(parsed));
}

export function serializeCaptureFrontmatter(content: string, frontmatter: Record<string, unknown>): string {
	const info = getFrontMatterInfo(content);
	const body = info.exists ? content.slice(info.contentStart) : content;
	return `---\n${stringifyYaml(frontmatter)}---\n${body}`;
}
