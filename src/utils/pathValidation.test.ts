import { describe, expect, it } from "vitest";
import { isPortablePathSegment } from "./pathValidation";

describe("isPortablePathSegment", () => {
	it.each(["photo", "holiday photo", "foo.bar", "v1.2.3 release"])(
		"accepts %s",
		(segment) => {
			expect(isPortablePathSegment(segment)).toBe(true);
		},
	);

	it.each([
		"",
		".",
		"..",
		".hidden",
		"CON",
		"con",
		"CON.backup",
		"NUL.tar.gz",
		"bad:name",
		"report:final",
		"photo.",
		"photo ",
		`photo${String.fromCharCode(0x01)}`,
	])("rejects %s", (segment) => {
		expect(isPortablePathSegment(segment)).toBe(false);
	});
});
