import { describe, expect, it } from "vitest";
import {
	buildFileDisplayLabels,
	canonicalizeOnePageFileValue,
	decodeFileValue,
	fileBasenameFromPath,
	FILE_CUSTOM_PREFIX,
	FILE_PICK_PREFIX,
	FILE_VARIABLE_PREFIX,
	parseFileToken,
} from "./fileSyntax";

describe("parseFileToken", () => {
	it("returns null for an empty folder", () => {
		expect(parseFileToken("")).toBeNull();
		expect(parseFileToken("|link")).toBeNull();
		expect(parseFileToken("  ")).toBeNull();
	});

	it("parses a bare folder with the default name mode", () => {
		const parsed = parseFileToken("People");
		expect(parsed?.folderPath).toBe("People");
		expect(parsed?.mode).toBe("name");
		expect(parsed?.optional).toBe(false);
		expect(parsed?.allowCustomInput).toBe(false);
		expect(parsed?.filter.folder).toBe("People");
	});

	it("parses the mode flags (last one wins)", () => {
		expect(parseFileToken("People|link")?.mode).toBe("link");
		expect(parseFileToken("People|path")?.mode).toBe("path");
		expect(parseFileToken("People|name")?.mode).toBe("name");
		expect(parseFileToken("People|link|path")?.mode).toBe("path");
	});

	it("parses optional and custom bare flags", () => {
		const parsed = parseFileToken("People|optional|custom");
		expect(parsed?.optional).toBe(true);
		expect(parsed?.allowCustomInput).toBe(true);
	});

	it("parses label and the |name: alias", () => {
		const parsed = parseFileToken("People|link|label:Pick a person|name:reviewer");
		expect(parsed?.label).toBe("Pick a person");
		expect(parsed?.aliasName).toBe("reviewer");
		// The alias drives the variable key (shared identity), scoped to the folder.
		expect(parsed?.variableKey).toBe(
			`${FILE_VARIABLE_PREFIX}name=reviewer|folder=People`,
		);
	});

	it("reuses the FIELD filter grammar (folder/tag/exclude-*)", () => {
		const parsed = parseFileToken(
			"fields/people|tag:topic|exclude-folder:Archive|exclude-tag:wip|exclude-file:tmp.md",
		);
		expect(parsed?.filter.folder).toBe("fields/people");
		expect(parsed?.filter.tags).toEqual(["topic"]);
		expect(parsed?.filter.excludeFolders).toEqual(["Archive"]);
		expect(parsed?.filter.excludeTags).toEqual(["wip"]);
		expect(parsed?.filter.excludeFiles).toEqual(["tmp.md"]);
	});

	describe("variableKey identity", () => {
		it("differs by mode (independent prompts by default)", () => {
			const name = parseFileToken("People")!.variableKey;
			const link = parseFileToken("People|link")!.variableKey;
			expect(name).not.toBe(link);
		});

		it("collapses slash variants of the same folder", () => {
			const a = parseFileToken("People")!.variableKey;
			const b = parseFileToken("/People")!.variableKey;
			const c = parseFileToken("People/")!.variableKey;
			expect(a).toBe(b);
			expect(b).toBe(c);
		});

		it("is order-insensitive across filters", () => {
			const a = parseFileToken("People|tag:a|tag:b")!.variableKey;
			const b = parseFileToken("People|tag:b|tag:a")!.variableKey;
			expect(a).toBe(b);
		});

		it("differs by optional/custom flags", () => {
			const base = parseFileToken("People")!.variableKey;
			expect(parseFileToken("People|optional")!.variableKey).not.toBe(base);
			expect(parseFileToken("People|custom")!.variableKey).not.toBe(base);
		});

		it("differs by label (distinct prompts, e.g. Author vs Reviewer)", () => {
			const author = parseFileToken("People|label:Author")!.variableKey;
			const reviewer = parseFileToken("People|label:Reviewer")!.variableKey;
			expect(author).not.toBe(reviewer);
		});

		it("shares the key across tokens with the same |name: and folder", () => {
			const a = parseFileToken("People|link|name:r")!.variableKey;
			const b = parseFileToken("People|name:r")!.variableKey;
			expect(a).toBe(b);
		});

		it("does NOT share |name: across different folders", () => {
			const people = parseFileToken("People|name:ref")!.variableKey;
			const projects = parseFileToken("Projects|name:ref")!.variableKey;
			expect(people).not.toBe(projects);
		});

		it("does NOT share |name: across different filters (different file lists)", () => {
			const pub = parseFileToken("People|tag:public|name:ref")!.variableKey;
			const priv = parseFileToken("People|tag:private|name:ref")!.variableKey;
			expect(pub).not.toBe(priv);
		});

		it("DOES share |name: across modes within the same scope", () => {
			const name = parseFileToken("People|tag:x|name:ref")!.variableKey;
			const link = parseFileToken("People|tag:x|link|name:ref")!.variableKey;
			const path = parseFileToken("People|tag:x|path|name:ref")!.variableKey;
			expect(name).toBe(link);
			expect(link).toBe(path);
		});
	});
});

describe("decodeFileValue", () => {
	it("classifies empty, file, custom, and raw", () => {
		expect(decodeFileValue("")).toEqual({ kind: "empty" });
		expect(decodeFileValue(undefined)).toEqual({ kind: "empty" });
		expect(decodeFileValue(`${FILE_PICK_PREFIX}People/Tom.md`)).toEqual({
			kind: "file",
			path: "People/Tom.md",
		});
		expect(decodeFileValue(`${FILE_CUSTOM_PREFIX}Alice`)).toEqual({
			kind: "custom",
			text: "Alice",
		});
		expect(decodeFileValue("People/Tom.md")).toEqual({
			kind: "raw",
			value: "People/Tom.md",
		});
	});
});

describe("canonicalizeOnePageFileValue", () => {
	const picks = [
		`${FILE_PICK_PREFIX}People/Tom.md`,
		`${FILE_PICK_PREFIX}People/Jack.md`,
	];

	it("keeps an exact encoded pick as-is", () => {
		expect(
			canonicalizeOnePageFileValue(`${FILE_PICK_PREFIX}People/Tom.md`, picks),
		).toBe(`${FILE_PICK_PREFIX}People/Tom.md`);
	});

	it("wraps typed text as custom", () => {
		expect(canonicalizeOnePageFileValue("Alice", picks)).toBe(
			`${FILE_CUSTOM_PREFIX}Alice`,
		);
	});

	it("does NOT let a typed @file: sentinel spoof a pick", () => {
		// User types the internal sentinel verbatim into a |custom field.
		const spoof = `${FILE_PICK_PREFIX}Archive/Secret.md`;
		const out = canonicalizeOnePageFileValue(spoof, picks);
		// It is treated as literal custom text, not a real pick.
		expect(out).toBe(`${FILE_CUSTOM_PREFIX}${spoof}`);
		expect(decodeFileValue(out)).toEqual({ kind: "custom", text: spoof });
	});

	it("leaves empty (skip) untouched", () => {
		expect(canonicalizeOnePageFileValue("", picks)).toBe("");
	});
});

describe("fileBasenameFromPath", () => {
	it("drops folders and a trailing markdown-family extension", () => {
		expect(fileBasenameFromPath("People/Tom.md")).toBe("Tom");
		expect(fileBasenameFromPath("a/b/My.Notes.md")).toBe("My.Notes");
		expect(fileBasenameFromPath("Diagrams/x.canvas")).toBe("x");
		expect(fileBasenameFromPath("Alice")).toBe("Alice");
	});
});

describe("buildFileDisplayLabels", () => {
	const makeFile = (path: string) => {
		const segment = path.split("/").pop() ?? path;
		const basename = segment.replace(/\.md$/, "");
		const parentPath = path.includes("/")
			? path.slice(0, path.lastIndexOf("/"))
			: "/";
		return { basename, parent: { path: parentPath } } as never;
	};

	it("uses bare basenames when unambiguous", () => {
		const labels = buildFileDisplayLabels([
			makeFile("People/Tom.md"),
			makeFile("People/Jack.md"),
		]);
		expect(labels).toEqual(["Tom", "Jack"]);
	});

	it("disambiguates duplicate basenames with the parent folder", () => {
		const labels = buildFileDisplayLabels([
			makeFile("Companies/Apple.md"),
			makeFile("Fruits/Apple.md"),
		]);
		expect(labels).toEqual(["Apple (Companies)", "Apple (Fruits)"]);
	});
});
