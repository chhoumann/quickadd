import { deepClone } from "./deepClone";

export function excludeKeys<T extends object, K extends keyof T>(
	sourceObj: T,
	except: K[],
): Omit<T, K> {
	const obj = deepClone(sourceObj);

	for (const key of except) {
		delete obj[key];
	}

	return obj;
}
