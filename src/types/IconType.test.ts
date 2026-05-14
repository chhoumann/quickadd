import { describe, expect, test } from "vitest";
import { ICON_LIST, type IconType } from "./IconType";

describe("IconType", () => {
	test("keeps the runtime icon list deduplicated", () => {
		expect(ICON_LIST).toHaveLength(new Set(ICON_LIST).size);
	});

	test("preserves representative legacy and lucide-prefixed icon values", () => {
		const representativeIcons: IconType[] = [
			"activity",
			"search",
			"search-large",
			"lucide-search",
			"lucide-trash",
		];

		expect(ICON_LIST).toEqual(expect.arrayContaining(representativeIcons));
	});
});
