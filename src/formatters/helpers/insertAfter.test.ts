import insertAfter from "./insertAfter";
import { test, expect } from "vitest";

test("inserts value after target", () => {
	const target = "# Meeting Notes";
	const value = "## Topic C\n";
	const body = `# Meeting Notes

## Topic A

## Topic B`;

    const expected = `# Meeting Notes

## Topic A

## Topic B

${value}`;
	const result = insertAfter(target, value, body);
    expect(result.success).toBeTruthy();
    if (result.success) expect(result.value).toBe(expected);
});
