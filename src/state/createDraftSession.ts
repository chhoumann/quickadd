import { deepClone } from "../utils/deepClone";

export interface DraftSession<T> {
	draft: T;
	commit(): T;
	discard(): void;
	isDirty(): boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) {
		return true;
	}

	if (!isObject(a) || !isObject(b)) {
		return false;
	}

	if (Array.isArray(a) !== Array.isArray(b)) {
		return false;
	}

	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) {
			return false;
		}

		for (let i = 0; i < a.length; i += 1) {
			if (!deepEqual(a[i], b[i])) {
				return false;
			}
		}

		return true;
	}

	const aEntries = Object.entries(a);
	const bEntries = Object.entries(b);
	if (aEntries.length !== bEntries.length) {
		return false;
	}

	for (const [key, value] of aEntries) {
		if (!(key in b)) {
			return false;
		}

		if (!deepEqual(value, b[key])) {
			return false;
		}
	}

	return true;
}

function replaceObject(target: Record<string, unknown>, source: object): void {
	for (const key of Object.keys(target)) {
		if (!(key in source)) {
			delete target[key];
		}
	}

	for (const [key, value] of Object.entries(source)) {
		target[key] = value;
	}
}

export function createDraftSession<T extends object>(source: T): DraftSession<T> {
	const baseline = deepClone(source);
	const draft = deepClone(source);

	return {
		draft,
		commit() {
			const committed = deepClone(draft);
			replaceObject(baseline as Record<string, unknown>, committed);
			return committed;
		},
		discard() {
			const reset = deepClone(baseline);
			replaceObject(draft as Record<string, unknown>, reset);
		},
		isDirty() {
			return !deepEqual(draft, baseline);
		},
	};
}
