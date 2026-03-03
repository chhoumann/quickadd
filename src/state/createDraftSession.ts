import { deepClone } from "../utils/deepClone";

export interface DraftSession<T> {
	draft: T;
	commit(): T;
	discard(): void;
	isDirty(): boolean;
}

interface MutationTrackedDraft<T extends object> {
	draft: T;
	getVersion(): number;
	resetFrom(source: T): void;
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

function createMutationTrackedDraft<T extends object>(
	initial: T,
): MutationTrackedDraft<T> {
	const rootTarget = initial as Record<string, unknown>;
	let mutationVersion = 0;
	let suppressMutationTracking = false;
	const targetToProxy = new WeakMap<object, object>();
	const proxyToTarget = new WeakMap<object, object>();

	const unwrap = (value: unknown): unknown => {
		if (!isObject(value)) return value;
		return proxyToTarget.get(value) ?? value;
	};

	const wrap = <TValue>(value: TValue): TValue => {
		if (!isObject(value)) return value;
		const existingProxy = targetToProxy.get(value);
		if (existingProxy) {
			return existingProxy as TValue;
		}

		const proxy = new Proxy(value, {
			get: (target, property, receiver) => {
				const current = Reflect.get(target, property, receiver);
				return wrap(current);
			},
			set: (target, property, valueToSet, receiver) => {
				const normalizedValue = unwrap(valueToSet);
				const previousValue = Reflect.get(target, property, receiver);
				const changed = !Object.is(previousValue, normalizedValue);
				const result = Reflect.set(target, property, normalizedValue, receiver);
				if (result && changed && !suppressMutationTracking) {
					mutationVersion += 1;
				}
				return result;
			},
			deleteProperty: (target, property) => {
				const hadProperty = Object.prototype.hasOwnProperty.call(target, property);
				const result = Reflect.deleteProperty(target, property);
				if (result && hadProperty && !suppressMutationTracking) {
					mutationVersion += 1;
				}
				return result;
			},
		});

		targetToProxy.set(value, proxy);
		proxyToTarget.set(proxy, value);
		return proxy as TValue;
	};

	const setDraftValue = (nextSource: T): void => {
		suppressMutationTracking = true;
		try {
			replaceObject(rootTarget, deepClone(nextSource));
		} finally {
			suppressMutationTracking = false;
		}
		mutationVersion += 1;
	};

	return {
		draft: wrap(rootTarget) as T,
		getVersion: () => mutationVersion,
		resetFrom: setDraftValue,
	};
}

export function createDraftSession<T extends object>(source: T): DraftSession<T> {
	const baseline = deepClone(source);
	const tracker = createMutationTrackedDraft(deepClone(source));
	let lastCheckedVersion = tracker.getVersion();
	let lastKnownDirty = false;

	return {
		draft: tracker.draft,
		commit() {
			const committed = deepClone(tracker.draft);
			replaceObject(baseline as Record<string, unknown>, committed);
			lastCheckedVersion = tracker.getVersion();
			lastKnownDirty = false;
			return committed;
		},
		discard() {
			tracker.resetFrom(baseline);
			lastCheckedVersion = tracker.getVersion();
			lastKnownDirty = false;
		},
		isDirty() {
			const currentVersion = tracker.getVersion();
			if (currentVersion === lastCheckedVersion) {
				return lastKnownDirty;
			}

			lastKnownDirty = !deepEqual(tracker.draft, baseline);
			lastCheckedVersion = currentVersion;
			return lastKnownDirty;
		},
	};
}
