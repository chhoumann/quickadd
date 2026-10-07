// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { decodeFromBase64, encodeToBase64 } from "./base64";

describe("base64 through window.btoa/atob, as in Obsidian", () => {
	it("round-trips non-ASCII text and matches the Buffer encoding", () => {
		const btoa = vi.spyOn(window, "btoa");
		const atob = vi.spyOn(window, "atob");
		const text = "Café ✓ 🚀 日本";

		const encoded = encodeToBase64(text);

		expect(encoded).toBe(Buffer.from(text, "utf8").toString("base64"));
		expect(decodeFromBase64(encoded)).toBe(text);
		expect(btoa).toHaveBeenCalledOnce();
		expect(atob).toHaveBeenCalledOnce();
	});
});
