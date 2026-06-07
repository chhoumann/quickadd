import { describe, expect, it, vi } from "vitest";
import type { QuickAddPackage } from "../types/packages/QuickAddPackage";

// In the real Electron runtime decodeFromBase64 uses window.atob, which THROWS
// on malformed base64; jsdom's Buffer path silently decodes garbage, so the
// error branch can only be exercised by mocking decode to throw.
vi.mock("../utils/base64", () => ({
	decodeFromBase64: () => {
		throw new Error("Invalid base64");
	},
	encodeToBase64: (value: string) => value,
}));

import { decodeAssetPreview } from "./packagePreview";

function pkgWith(content: string): QuickAddPackage {
	return {
		schemaVersion: 1,
		quickAddVersion: "1.18.0",
		createdAt: "2026-06-01T00:00:00.000Z",
		rootChoiceIds: [],
		choices: [],
		assets: [
			{
				kind: "user-script",
				originalPath: "scripts/bad.js",
				contentEncoding: "base64",
				content,
			},
		],
	};
}

describe("decodeAssetPreview malformed content", () => {
	it("degrades to an error result instead of throwing", () => {
		const result = decodeAssetPreview(pkgWith("!!!not-base64!!!"), "scripts/bad.js");
		expect(result.found).toBe(true);
		expect(result.error).toBeTruthy();
		expect(result.text).toBe("");
		expect(result.truncated).toBe(false);
	});
});
