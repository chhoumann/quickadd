const textEncoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : undefined;
const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : undefined;

function hasWindowFunction(name: "btoa" | "atob"): boolean {
	if (typeof window === "undefined") return false;
	const fn = (window as unknown as Record<string, unknown>)[name];
	return typeof fn === "function";
}

function getGlobalBuffer(): undefined | { from(input: string, encoding: string): { toString(encoding: string): string } } {
	// `Buffer` is a Node global (present in Obsidian's Electron renderer and in
	// tests); reference it directly via a `typeof` guard rather than reaching
	// through `globalThis` (disallowed for popout compatibility). It is only a
	// fallback — Obsidian normally takes the `window.btoa`/`atob` path above.
	if (typeof Buffer === "undefined") {
		return undefined;
	}
	return Buffer as unknown as {
		from(input: string, encoding: string): { toString(encoding: string): string };
	};
}

export function encodeToBase64(value: string): string {
	if (textEncoder && hasWindowFunction("btoa")) {
		const bytes = textEncoder.encode(value);
		let binary = "";
		for (let i = 0; i < bytes.length; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return window.btoa(binary);
	}

	const buffer = getGlobalBuffer();
	if (buffer) {
		return buffer.from(value, "utf8").toString("base64");
	}

	throw new Error("Base64 encoding is not supported in this environment.");
}

export function decodeFromBase64(value: string): string {
	if (textDecoder && hasWindowFunction("atob")) {
		const binary = window.atob(value);
		const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
		return textDecoder.decode(bytes);
	}

	const buffer = getGlobalBuffer();
	if (buffer) {
		return buffer.from(value, "base64").toString("utf8");
	}

	throw new Error("Base64 decoding is not supported in this environment.");
}
