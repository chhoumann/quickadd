export const DATE_ORIGIN_UNITS = ["days", "weeks", "months", "years"] as const;

export type DateOriginUnit = (typeof DATE_ORIGIN_UNITS)[number];

export type DateOrigin =
	| { kind: "now" }
	| { kind: "ask"; defaultValue?: string }
	| { kind: "relative"; offset: number; unit: DateOriginUnit }
	| { kind: "variable"; name: string };

export interface RunClocks {
	now: Date;
	date?: Date;
}

export function isDateOriginUnit(value: unknown): value is DateOriginUnit {
	return (
		typeof value === "string" &&
		(DATE_ORIGIN_UNITS as readonly string[]).includes(value)
	);
}

export function normalizeDateOrigin(raw: unknown): DateOrigin | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;

	switch (record.kind) {
		case "now":
			return { kind: "now" };
		case "ask": {
			const defaultValue =
				typeof record.defaultValue === "string"
					? record.defaultValue.trim()
					: "";
			return defaultValue
				? { kind: "ask", defaultValue }
				: { kind: "ask" };
		}
		case "relative": {
			if (
				typeof record.offset !== "number" ||
				!Number.isInteger(record.offset) ||
				!isDateOriginUnit(record.unit)
			) {
				return undefined;
			}
			return { kind: "relative", offset: record.offset, unit: record.unit };
		}
		case "variable": {
			if (typeof record.name !== "string" || !record.name.trim()) {
				return undefined;
			}
			return { kind: "variable", name: record.name.trim() };
		}
		default:
			return undefined;
	}
}
