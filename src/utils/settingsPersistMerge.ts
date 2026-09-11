import { deepClone } from "./deepClone";

/**
 * Structural equality for JSON-like settings values. Key order does not matter;
 * array order does. Used to decide which side of a 3-way merge "changed".
 */
export function settingsValuesEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (a === null || b === null) return a === b;
	if (typeof a !== typeof b) return false;

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		return a.every((item, index) => settingsValuesEqual(item, b[index]));
	}

	if (typeof a === "object" && typeof b === "object") {
		const aRecord = a as Record<string, unknown>;
		const bRecord = b as Record<string, unknown>;
		const aKeys = Object.keys(aRecord);
		const bKeys = Object.keys(bRecord);
		if (aKeys.length !== bKeys.length) return false;
		return aKeys.every(
			(key) =>
				Object.prototype.hasOwnProperty.call(bRecord, key) &&
				settingsValuesEqual(aRecord[key], bRecord[key]),
		);
	}

	return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

/** Provider-shaped entries carry a `models` list (see `AIProvider`). */
function isProviderLike(value: unknown): value is Record<string, unknown> {
	return (
		isPlainObject(value) &&
		typeof value.name === "string" &&
		Array.isArray(value.models)
	);
}

/**
 * Model-shaped entries have a string `name` and are not providers. Prefer
 * `maxTokens` when present (the `Model` interface), but accept name-only stubs
 * used in tests and partial settings.
 */
function isModelLike(value: unknown): value is Record<string, unknown> {
	return (
		isPlainObject(value) &&
		typeof value.name === "string" &&
		!Array.isArray(value.models)
	);
}

function providerMergeKey(provider: Record<string, unknown>): string {
	if (typeof provider.id === "string" && provider.id.trim().length > 0) {
		return `id:${provider.id.trim().toLowerCase()}`;
	}
	const name = String(provider.name ?? "")
		.trim()
		.toLowerCase();
	const endpoint = String(provider.endpoint ?? "")
		.trim()
		.toLowerCase()
		.replace(/\/+$/, "");
	return `name:${name}\u0000${endpoint}`;
}

function modelMergeKey(model: Record<string, unknown>): string {
	return String(model.name ?? "")
		.trim()
		.toLowerCase();
}

function indexByKey(
	items: unknown[],
	keyOf: (item: Record<string, unknown>) => string,
): Map<string, Record<string, unknown>> {
	const map = new Map<string, Record<string, unknown>>();
	for (const item of items) {
		if (!isPlainObject(item)) continue;
		const key = keyOf(item);
		if (!key || key === "id:" || key === "name:\u0000") continue;
		if (!map.has(key)) map.set(key, item);
	}
	return map;
}

/**
 * Three-way merge of object arrays keyed by identity. Local order is preserved;
 * disk-only additions are appended. Local deletions win over disk-only edits of
 * the same key (same prefer-local conflict policy as leaf merges).
 */
function threeWayMergeKeyedArray(
	base: unknown[] | undefined,
	local: unknown[],
	disk: unknown[],
	keyOf: (item: Record<string, unknown>) => string,
): unknown[] {
	const baseMap = indexByKey(base ?? [], keyOf);
	const localMap = indexByKey(local, keyOf);
	const diskMap = indexByKey(disk, keyOf);
	const result: unknown[] = [];
	const seen = new Set<string>();

	for (const item of local) {
		if (!isPlainObject(item)) {
			result.push(deepClone(item));
			continue;
		}
		const key = keyOf(item);
		if (seen.has(key)) continue;
		seen.add(key);

		const baseItem = baseMap.get(key);
		const diskItem = diskMap.get(key);

		if (!diskMap.has(key)) {
			if (!baseMap.has(key)) {
				// Local addition.
				result.push(deepClone(item));
			} else if (!settingsValuesEqual(item, baseItem)) {
				// Local edit vs disk deletion — prefer keeping the local edit.
				result.push(deepClone(item));
			}
			// else: unchanged locally and deleted on disk → drop.
			continue;
		}

		result.push(
			threeWayMergeSettings(
				baseItem as Record<string, unknown> | undefined,
				item,
				diskItem,
			),
		);
	}

	for (const item of disk) {
		if (!isPlainObject(item)) continue;
		const key = keyOf(item);
		if (seen.has(key)) continue;
		seen.add(key);

		if (!localMap.has(key)) {
			if (!baseMap.has(key)) {
				// Disk-only addition.
				result.push(deepClone(item));
			}
			// else: present in base, absent locally → local deletion wins.
		}
	}

	return result;
}

function everyItem<T>(
	items: unknown[],
	predicate: (value: unknown) => value is T,
): items is T[] {
	return items.length > 0 && items.every(predicate);
}

/**
 * Three-way merge for QuickAdd settings (and nested JSON-like values).
 *
 * - If local is unchanged from base, take disk (preserves external edits).
 * - If disk is unchanged from base, take local (preserves in-memory edits).
 * - If both changed the same plain object, recurse per key.
 * - `ai.providers` arrays merge by `AIProvider.id` (fallback: name+endpoint);
 *   each provider's `models` merge by `Model.name`.
 * - Other irreducible array/leaf conflicts prefer local.
 *
 * This is the data-integrity seam for #1749: a background model-sync write must
 * not clobber newer on-disk fields it never touched.
 */
export function threeWayMergeSettings<T>(base: T, local: T, disk: T): T {
	if (settingsValuesEqual(local, disk)) return deepClone(local);
	if (settingsValuesEqual(local, base)) return deepClone(disk);
	if (settingsValuesEqual(disk, base)) return deepClone(local);

	if (isPlainObject(base) && isPlainObject(local) && isPlainObject(disk)) {
		const keys = new Set([
			...Object.keys(base),
			...Object.keys(local),
			...Object.keys(disk),
		]);
		const merged: Record<string, unknown> = {};
		for (const key of keys) {
			merged[key] = threeWayMergeSettings(
				base[key],
				local[key],
				disk[key],
			);
		}
		return merged as T;
	}

	const baseArr = Array.isArray(base) ? base : undefined;
	const localArr = Array.isArray(local) ? local : undefined;
	const diskArr = Array.isArray(disk) ? disk : undefined;

	if (localArr && diskArr) {
		const sample = [...localArr, ...diskArr, ...(baseArr ?? [])];
		if (everyItem(sample, isProviderLike)) {
			return threeWayMergeKeyedArray(
				baseArr,
				localArr,
				diskArr,
				providerMergeKey,
			) as T;
		}
		if (everyItem(sample, isModelLike)) {
			return threeWayMergeKeyedArray(
				baseArr,
				localArr,
				diskArr,
				modelMergeKey,
			) as T;
		}
	}

	// Other arrays and primitives: both sides diverged — keep the in-memory edit.
	return deepClone(local);
}

/**
 * True when `disk` diverged from the last successfully persisted snapshot.
 * Callers use this to decide whether a whole-file save needs a merge first.
 */
export function diskSettingsDivergedFromBase(
	base: unknown,
	disk: unknown,
): boolean {
	return !settingsValuesEqual(base, disk);
}

/**
 * Decide what to write for a whole-file settings save.
 *
 * `base` is the last snapshot QuickAdd successfully loaded or wrote. When the
 * on-disk file still matches that snapshot, the in-memory `local` value is
 * written as-is. When disk has moved on (sync / external edit), local changes
 * are three-way-merged onto disk so untouched fields are not clobbered (#1749).
 */
export function resolveSettingsToPersist<T>(
	base: T | null | undefined,
	local: T,
	disk: T | null | undefined,
): { toWrite: T; didMerge: boolean } {
	if (base == null || disk == null) {
		return { toWrite: local, didMerge: false };
	}
	if (!diskSettingsDivergedFromBase(base, disk)) {
		return { toWrite: local, didMerge: false };
	}
	return {
		toWrite: threeWayMergeSettings(base, local, disk),
		didMerge: true,
	};
}

/**
 * Finalize a persist plan after an async disk read.
 *
 * `local` is the in-memory snapshot the disk-aware merge used. If `currentStore`
 * has moved on since that snapshot (another edit while `loadData()` was in
 * flight), fold those edits onto `toWrite` with a three-way merge that treats
 * `local` as the base — so disk-only fields in `toWrite` survive while newer
 * store fields win (Codex P1 / CodeRabbit on #1750).
 *
 * `shouldReplaceStore` is true only when publishing `toWrite` back into the
 * store would not clobber a concurrent update still equal to `local`.
 */
export function reconcileSettingsPersistPlan<T>(options: {
	base: T | null | undefined;
	disk: T | null | undefined;
	local: T;
	currentStore: T;
}): {
	toWrite: T;
	didMerge: boolean;
	/** Local leg actually used for `toWrite` (may be `currentStore` after fold). */
	local: T;
	shouldReplaceStore: boolean;
} {
	let local = options.local;
	let { toWrite, didMerge } = resolveSettingsToPersist(
		options.base,
		local,
		options.disk,
	);

	if (!settingsValuesEqual(options.currentStore, local)) {
		toWrite = threeWayMergeSettings(
			local,
			options.currentStore,
			toWrite,
		);
		local = options.currentStore;
		didMerge = true;
	}

	const shouldReplaceStore =
		didMerge &&
		settingsValuesEqual(options.currentStore, local) &&
		!settingsValuesEqual(toWrite, options.currentStore);

	return { toWrite, didMerge, local, shouldReplaceStore };
}

/**
 * Whether the live settings store should be replaced with the value about to be
 * written to disk. True when `toWrite` differs from the store (e.g. it still
 * carries disk-only fields from a merge) and the store has not moved past the
 * snapshot used to compute that write. Skipping the replace would leave the
 * store stale so the next save treats those disk-only fields as local deletions.
 */
export function shouldApplyPersistedWriteToStore<T>(
	toWrite: T,
	currentStore: T,
	storeSnapshotUsedForMerge: T,
): boolean {
	return (
		!settingsValuesEqual(toWrite, currentStore) &&
		settingsValuesEqual(currentStore, storeSnapshotUsedForMerge)
	);
}
