import { describe, expect, it } from "vitest";
import { RequirementCollector } from "./RequirementCollector";
import {
	FILE_PICK_PREFIX,
	parseFileToken,
} from "src/utils/fileSyntax";

function makeFile(path: string) {
	const segment = path.split("/").pop() ?? path;
	const basename = segment.replace(/\.md$/, "");
	const parentPath = path.includes("/")
		? path.slice(0, path.lastIndexOf("/"))
		: "/";
	return { path, name: segment, basename, parent: { path: parentPath } };
}

const makeApp = (
	paths: string[],
	metadata: Record<string, unknown> = {},
) =>
	({
		workspace: { getActiveFile: () => null },
		vault: {
			getAbstractFileByPath: () => null,
			cachedRead: async () => "",
			getMarkdownFiles: () => paths.map(makeFile),
		},
		metadataCache: {
			getFileCache: (file: { path: string }) =>
				(metadata[file.path] as never) ?? null,
		},
	}) as never;

const makePlugin = () =>
	({
		settings: { inputPrompt: "single-line", globalVariables: {} },
	}) as never;

describe("RequirementCollector — {{FILE:...}}", () => {
	it("records a searchable file picker whose options round-trip as encoded paths", async () => {
		const app = makeApp([
			"Research Topics/Alpha.md",
			"Research Topics/Beta.md",
			"People/Tom.md", // outside the scope; must be excluded
		]);
		const rc = new RequirementCollector(app, makePlugin());
		await rc.scanString("- \"{{FILE:Research Topics|link}}\"");

		const key = parseFileToken("Research Topics|link")!.variableKey;
		const req = rc.requirements.get(key);
		expect(req).toBeDefined();
		expect(req?.type).toBe("file-picker");
		expect(req?.options).toEqual([
			`${FILE_PICK_PREFIX}Research Topics/Alpha.md`,
			`${FILE_PICK_PREFIX}Research Topics/Beta.md`,
		]);
		expect(req?.displayOptions).toEqual(["Alpha", "Beta"]);
	});

	it("uses title metadata for FILE option display labels", async () => {
		const app = makeApp(["People/01HX.md"], {
			"People/01HX.md": { frontmatter: { title: "Ada Lovelace" } },
		});
		const rc = new RequirementCollector(app, makePlugin());
		await rc.scanString("{{FILE:People|link}}");

		const key = parseFileToken("People|link")!.variableKey;
		const req = rc.requirements.get(key);
		expect(req?.displayOptions).toEqual(["Ada Lovelace (01HX)"]);
	});

	it("enables custom values only when |custom, with the flags set", async () => {
		const app = makeApp(["People/Tom.md"]);
		const rc = new RequirementCollector(app, makePlugin());
		await rc.scanString("{{FILE:People|optional|custom}}");

		const key = parseFileToken("People|optional|custom")!.variableKey;
		const req = rc.requirements.get(key);
		expect(req?.type).toBe("file-picker");
		expect(req?.optional).toBe(true);
		expect(req?.suggesterConfig?.allowCustomInput).toBe(true);
	});

	it("allows custom input when the folder has no markdown files", async () => {
		const app = makeApp(["People/Tom.md"]); // nothing under Empty/
		const rc = new RequirementCollector(app, makePlugin());
		await rc.scanString("{{FILE:Empty}}");

		const key = parseFileToken("Empty")!.variableKey;
		const req = rc.requirements.get(key);
		expect(req?.type).toBe("file-picker");
		expect(req?.options).toEqual([]);
		expect(req?.suggesterConfig?.allowCustomInput).toBe(true);
	});

	it("collects FILE multi-select requirements in the one-page form", async () => {
		const app = makeApp(["People/Tom.md", "People/Jack.md"]);
		const rc = new RequirementCollector(app, makePlugin());
		await rc.scanString("{{FILE:People|multi|link}}");

		const key = parseFileToken("People|multi|link")!.variableKey;
		const req = rc.requirements.get(key);
		expect(req?.runtimeOnly).toBeUndefined();
		expect(req?.type).toBe("file-picker");
		expect(req?.suggesterConfig?.multiSelect).toBe(true);
	});

	it("records ONE requirement for two |name:-shared tokens across modes", async () => {
		const app = makeApp(["People/Tom.md"]);
		const rc = new RequirementCollector(app, makePlugin());
		await rc.scanString(
			"{{FILE:People|name:ref}} as {{FILE:People|link|name:ref}}",
		);
		expect(rc.requirements.size).toBe(1);
		const key = parseFileToken("People|name:ref")!.variableKey;
		expect(rc.requirements.has(key)).toBe(true);
	});

	it("merges |optional across shared-id occurrences (required if any is required)", async () => {
		const app = makeApp(["People/Tom.md"]);
		const rc = new RequirementCollector(app, makePlugin());
		// optional first, required second — the shared requirement must be required.
		await rc.scanString(
			"{{FILE:People|optional|name:ref}} then {{FILE:People|link|name:ref}}",
		);
		const key = parseFileToken("People|name:ref")!.variableKey;
		expect(rc.requirements.size).toBe(1);
		expect(rc.requirements.get(key)?.optional).toBe(false);
	});

	it("keeps a shared-id requirement optional only when every occurrence is optional", async () => {
		const app = makeApp(["People/Tom.md"]);
		const rc = new RequirementCollector(app, makePlugin());
		await rc.scanString(
			"{{FILE:People|optional|name:ref}} then {{FILE:People|link|optional|name:ref}}",
		);
		const key = parseFileToken("People|name:ref")!.variableKey;
		expect(rc.requirements.get(key)?.optional).toBe(true);
	});

	it("upgrades a shared-id file picker to custom input order-independently", async () => {
		const app = makeApp(["People/Tom.md"]);
		const rc = new RequirementCollector(app, makePlugin());
		// non-custom first (would be a forced dropdown), |custom second.
		await rc.scanString(
			"{{FILE:People|name:ref}} then {{FILE:People|custom|name:ref}}",
		);
		const key = parseFileToken("People|name:ref")!.variableKey;
		const req = rc.requirements.get(key);
		expect(req?.type).toBe("file-picker");
		expect(req?.suggesterConfig?.allowCustomInput).toBe(true);
	});

	it("does not confuse {{FILENAMECURRENT}} with a FILE requirement", async () => {
		const app = makeApp(["People/Tom.md"]);
		const rc = new RequirementCollector(app, makePlugin());
		await rc.scanString("{{FILENAMECURRENT}} — {{FILE:People}}");

		const key = parseFileToken("People")!.variableKey;
		const fileReq = rc.requirements.get(key);
		expect(fileReq?.type).toBe("file-picker");
		expect(fileReq?.label).toBe("File from People");
		// Only the FILE token created a requirement.
		expect(rc.requirements.size).toBe(1);
	});
});
