/**
 * Loads a Node module through Obsidian's desktop `window.require`. Null on
 * mobile, where there is no require, and when the module cannot load, so the
 * mobile bundle never depends on Node.
 */
export function nodeRequire<T>(mod: string): T | null {
	try {
		const req = (window as unknown as { require?: (m: string) => unknown })
			.require;
		return req ? (req(mod) as T) : null;
	} catch {
		return null;
	}
}
