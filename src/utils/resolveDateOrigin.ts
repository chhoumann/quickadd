import { NLDParser } from "../parsers/NLDParser";
import type IChoice from "../types/choices/IChoice";
import {
	normalizeDateOrigin,
	type CallerDay,
	type DateOrigin,
	type DateOriginUnit,
	type RunClocks,
} from "../types/dateOrigin";
import { dateOriginForPick, isPickDateToken } from "../types/dateOriginPresets";
import { parseNaturalLanguageDate } from "./dateParser";
import { resolveExistingVariableKey } from "./valueSyntax";

type DateOriginPlan =
	| { status: "inherit" }
	| { status: "set"; date: Date }
	| { status: "ask"; defaultValue?: string }
	| { status: "error"; message: string };

export function addCalendarOffset(
	now: Date,
	offset: number,
	unit: DateOriginUnit,
): Date {
	return window.moment(now).add(offset, unit).startOf("day").toDate();
}

export function dateFromStoredValue(stored: unknown): Date | undefined {
	if (stored instanceof Date && !Number.isNaN(stored.getTime())) {
		return stored;
	}
	if (typeof stored !== "string") return undefined;

	const trimmed = stored.trim();
	if (!trimmed) return undefined;

	if (trimmed.toLowerCase().startsWith("@date:")) {
		const iso = trimmed.slice("@date:".length);
		const parsed = window.moment(iso);
		return parsed.isValid() ? parsed.toDate() : undefined;
	}

	const nl = parseNaturalLanguageDate(trimmed, undefined, NLDParser);
	if (nl.isValid && nl.isoString) {
		const parsed = window.moment(nl.isoString);
		return parsed.isValid() ? parsed.toDate() : undefined;
	}

	return undefined;
}

/**
 * The Which day a choice resolves with, and the clocks it may inherit a day
 * from. A caller's day replaces both, even under an enclosing day.
 */
export function dateOriginInput(
	choice: IChoice,
	executor: { clocks?: RunClocks; callerDay?: CallerDay },
): { setting?: DateOrigin; clocks?: RunClocks } {
	const { callerDay, clocks } = executor;
	const own = normalizeDateOrigin(choice.dateOrigin);
	if (callerDay === undefined) return { setting: own, clocks };
	const now = clocks?.now ?? new Date();
	if (callerDay === "pick") {
		return { setting: dateOriginForPick(own), clocks: { now } };
	}
	return { setting: undefined, clocks: { now, date: callerDay } };
}

export function planDateOrigin(input: {
	setting?: DateOrigin;
	clocks?: RunClocks;
	variables?: Map<string, unknown>;
	reservedSeed?: unknown;
}): DateOriginPlan {
	// A variable names its own day, so an enclosing day doesn't replace it.
	if (input.clocks?.date && input.setting?.kind !== "variable") {
		return { status: "inherit" };
	}

	if (input.reservedSeed !== undefined) {
		const date = dateFromStoredValue(input.reservedSeed);
		if (date) return { status: "set", date };
		return {
			status: "error",
			message: "Could not parse the seeded date origin.",
		};
	}

	const setting = input.setting;
	if (!setting || setting.kind === "now") return { status: "inherit" };

	if (setting.kind === "ask") {
		return { status: "ask", defaultValue: setting.defaultValue };
	}

	if (setting.kind === "relative") {
		const now = input.clocks?.now ?? new Date();
		return {
			status: "set",
			date: addCalendarOffset(now, setting.offset, setting.unit),
		};
	}

	const variables = input.variables;
	if (!variables) {
		return {
			status: "error",
			message: `Date origin variable "${setting.name}" is not available.`,
		};
	}
	const key = resolveExistingVariableKey(variables, setting.name);
	if (!key) {
		return {
			status: "error",
			message: `Date origin variable "${setting.name}" is not set.`,
		};
	}
	const date = dateFromStoredValue(variables.get(key));
	if (!date) {
		return {
			status: "error",
			message: `Date origin variable "${setting.name}" is not a date.`,
		};
	}
	return { status: "set", date };
}

export function applyInvocationDate(
	executor: { callerDay?: CallerDay },
	raw: unknown,
): boolean {
	if (raw === undefined || raw === null) return true;
	if (typeof raw === "string" && !raw.trim()) return true;
	if (isPickDateToken(raw)) {
		executor.callerDay = "pick";
		return true;
	}
	const date = dateFromStoredValue(raw);
	if (!date) return false;
	executor.callerDay = date;
	return true;
}
