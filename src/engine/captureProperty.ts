import { getFrontMatterInfo, parseYaml, stringifyYaml } from "obsidian";
import type { PropertyCapture } from "../types/choices/ICaptureChoice";

export type CapturePropertyValue = string | number | boolean | string[];

export function validatePropertyName(input: string): string {
	const key = input.trim();
	if (!key || /[\r\n\0]/.test(key) || key === "__proto__") {
		throw new Error("Property name must be nonempty and contain no line breaks or unsafe keys.");
	}
	return key;
}

export function resolveCapturePropertyKey(frontmatter: Record<string, unknown>, requested: string): string {
	if (Object.prototype.hasOwnProperty.call(frontmatter, requested)) return requested;
	const matches = Object.keys(frontmatter).filter((key) => key.trim().toLowerCase() === requested.trim().toLowerCase());
	if (matches.length > 1) throw new Error(`Property '${requested}' matches multiple properties in the target note.`);
	return matches[0] ?? requested;
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
	if (config.action === "addToList") {
		if (current !== null && !Array.isArray(current)) {
			throw new Error(`Property '${key}' is ${inferType(current)}. 'Add to list' requires a list.`);
		}
		if (type !== null && type !== "list") {
			throw new Error(`Property '${key}' is ${type}. 'Add to list' requires a list.`);
		}
		const items = typeof captured === "string" ? captured === "" ? [] : [captured] : captured;
		if (!Array.isArray(items)) throw new Error(`Property '${key}' requires text or a list of text to add.`);
		if (items.length === 0) return current ?? [];
		return [...new Set([...(current ?? []), ...items])];
	}
	if (type === "list" && current !== null && !Array.isArray(current)) {
		throw new Error(`Property '${key}' contains ${inferType(current)}. Set a list only after correcting the existing property to a list.`);
	}
	const next = type === "list" && typeof captured === "string"
		? captured === "" ? [] : [captured]
		: captured;
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
