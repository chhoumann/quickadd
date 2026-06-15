import {
	TFolder,
	type App,
	TFile,
	type WorkspaceLeaf,
	type WorkspaceParent,
} from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
	__test,
	areSameVaultFilePath,
	getAllFolderPathsInVault,
	getUserScript,
	normalizeVaultFilePath,
	getOpenFileOriginLeaf,
	openFile,
	insertIntoFrontmatterProperty,
} from "./utilityObsidian";
import type { IUserScript } from "./types/macros/IUserScript";
import { CommandType } from "./types/macros/CommandType";

const { convertLinkToEmbed, extractMarkdownLinkTarget } = __test;

type FakeLeaf = WorkspaceLeaf & {
	id: string;
	pinned?: boolean;
	openFile: ReturnType<typeof vi.fn>;
	getViewState: ReturnType<typeof vi.fn>;
	setViewState: ReturnType<typeof vi.fn>;
};

function createLeaf(id: string, pinned = false): FakeLeaf {
	const leaf = { id, pinned } as FakeLeaf;

	leaf.openFile = vi.fn(async () => undefined);
	leaf.getViewState = vi.fn(() => ({
		type: "markdown",
		state: { file: `${id}.md` },
		...(leaf.pinned ? { pinned: true } : {}),
	}));
	leaf.setViewState = vi.fn(async () => undefined);

	return leaf;
}

function createFile(path = "target.md"): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.extension = path.split(".").pop() ?? "";
	file.basename = file.name.replace(/\.[^.]+$/, "");
	return file;
}

function createFolder(path: string): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path.split("/").pop() ?? path;
	return folder;
}

function setParent(leaf: FakeLeaf, parent: { id: string }): FakeLeaf {
	(leaf as unknown as { parent: { id: string } }).parent = parent;
	return leaf;
}

function createApp({
	rootLeaves,
	originLeaf,
	activeLeaf = originLeaf,
	mostRecentLeaf = originLeaf,
	tabLeaf = createLeaf("tab"),
	reuseLeaf = activeLeaf ?? tabLeaf,
	splitLeaf = createLeaf("split"),
	windowLeaf = createLeaf("window"),
	leftSidebarLeaf = createLeaf("left-sidebar"),
	rightSidebarLeaf = createLeaf("right-sidebar"),
	rootSplit = { id: "root-split" } as unknown as WorkspaceParent,
}: {
	rootLeaves: FakeLeaf[];
	originLeaf: FakeLeaf | null;
	activeLeaf?: FakeLeaf | null;
	mostRecentLeaf?: FakeLeaf | null;
	tabLeaf?: FakeLeaf;
	reuseLeaf?: FakeLeaf;
	splitLeaf?: FakeLeaf;
	windowLeaf?: FakeLeaf;
	leftSidebarLeaf?: FakeLeaf;
	rightSidebarLeaf?: FakeLeaf;
	rootSplit?: WorkspaceParent | null;
}) {
	const getLeaf = vi.fn((location?: unknown) => {
		if (location === "tab") return tabLeaf;
		if (location === false) return reuseLeaf;
		if (location === "split") return splitLeaf;
		if (location === "window") return windowLeaf;
		return reuseLeaf;
	});
	const setActiveLeaf = vi.fn();
	const getMostRecentLeaf = vi.fn(() => mostRecentLeaf);
	const iterateRootLeaves = vi.fn((callback: (leaf: WorkspaceLeaf) => void) => {
		rootLeaves.forEach(callback);
	});

	const app = {
		workspace: {
			activeLeaf,
			rootSplit,
			getMostRecentLeaf,
			getLeaf,
			getLeftLeaf: vi.fn(() => leftSidebarLeaf),
			getRightLeaf: vi.fn(() => rightSidebarLeaf),
			iterateRootLeaves,
			setActiveLeaf,
		},
		vault: {
			getAbstractFileByPath: vi.fn(),
		},
	} as unknown as App;

	return {
		app,
		getLeaf,
		getMostRecentLeaf,
		rootSplit,
		iterateRootLeaves,
		setActiveLeaf,
	};
}

describe("convertLinkToEmbed", () => {
	it("converts wiki links to embeds", () => {
		expect(convertLinkToEmbed("[[Note]]")).toBe("![[Note]]");
	});

	it("leaves already embedded wiki links unchanged", () => {
		expect(convertLinkToEmbed("![[Note]]")).toBe("![[Note]]");
	});

	it("converts markdown links into wiki embeds", () => {
		expect(convertLinkToEmbed("[Title](../Note.md)")).toBe("![[../Note.md]]");
	});

	it("preserves markdown heading targets when embedding", () => {
		expect(convertLinkToEmbed("[Title](Note.md#Heading)")).toBe("![[Note.md#Heading]]");
	});

	it("strips surrounding angle brackets before embedding", () => {
		expect(convertLinkToEmbed("[Title](<path/to/note.md>)")).toBe("![[path/to/note.md]]");
	});

	it("converts plain text references by prefixing a bang", () => {
		expect(convertLinkToEmbed("Note")).toBe("!Note");
	});

	it("prefixes malformed markdown links so they still embed", () => {
		expect(convertLinkToEmbed("[Title](Note.md")).toBe("![Title](Note.md");
	});

	it("trims whitespace around markdown links before conversion", () => {
		const link = "   [Label](../Another Note.md#Heading)   ";
		expect(convertLinkToEmbed(link)).toBe("![[../Another Note.md#Heading]]");
	});
});

describe("extractMarkdownLinkTarget", () => {
	it("extracts targets from standard markdown links", () => {
		expect(extractMarkdownLinkTarget("[Label](Note.md)")).toBe("Note.md");
	});

	it("handles image-style markdown links", () => {
		expect(extractMarkdownLinkTarget("![Label](Note.md)")).toBe("Note.md");
	});

	it("includes heading fragments when present", () => {
		expect(extractMarkdownLinkTarget("[Label](Note.md#Heading)")).toBe("Note.md#Heading");
	});

	it("removes surrounding angle brackets", () => {
		expect(extractMarkdownLinkTarget("[Label](<Note.md>)")).toBe("Note.md");
	});

	it("trims whitespace inside parentheses", () => {
		expect(extractMarkdownLinkTarget("[Label](   Note.md  )")).toBe("Note.md");
	});

	it("returns null for wiki links", () => {
		expect(extractMarkdownLinkTarget("[[Note]]")).toBeNull();
	});

	it("returns null for malformed markdown", () => {
		expect(extractMarkdownLinkTarget("[Label](Note.md")).toBeNull();
	});

	it("returns null for empty targets", () => {
		expect(extractMarkdownLinkTarget("[Label]()")).toBeNull();
	});
});

describe("getAllFolderPathsInVault", () => {
	it("filters to folders and maps paths without sorting", () => {
		const app = {
			vault: {
				getAllLoadedFiles: vi.fn(() => [
					createFolder("B"),
					{ path: "A/file.md" },
					createFolder("A"),
					createFolder("A/C"),
				]),
			},
		} as unknown as App;

		expect(getAllFolderPathsInVault(app)).toEqual(["B", "A", "A/C"]);
	});
});

describe("getUserScript", () => {
	function createUserScriptCommand(
		options: Partial<IUserScript> = {},
	): IUserScript {
		return {
			id: "script",
			name: "Script",
			type: CommandType.UserScript,
			path: "Scripts/script.js",
			settings: {},
			...options,
		};
	}

	function createUserScriptApp(fileContent: string) {
		const file = createFile("Scripts/script.js");
		return {
			vault: {
				getAbstractFileByPath: vi.fn(() => file),
				read: vi.fn(async () => fileContent),
			},
		} as unknown as App;
	}

	it("executes CommonJS user scripts with Obsidian globals available", async () => {
		const app = createUserScriptApp(`
			module.exports = {
				globalType: typeof globalThis,
				globalValue: globalThis.__quickAddEvalCompatibilityGlobal,
			};
		`);
		const previousGlobal = (
			globalThis as { __quickAddEvalCompatibilityGlobal?: string }
		).__quickAddEvalCompatibilityGlobal;
		(
			globalThis as { __quickAddEvalCompatibilityGlobal?: string }
		).__quickAddEvalCompatibilityGlobal = "visible";

		try {
			const script = await getUserScript(createUserScriptCommand(), app);

			expect(script).toEqual({
				globalType: "object",
				globalValue: "visible",
			});
		} finally {
			if (previousGlobal === undefined) {
				delete (
					globalThis as { __quickAddEvalCompatibilityGlobal?: string }
				).__quickAddEvalCompatibilityGlobal;
			} else {
				(
					globalThis as { __quickAddEvalCompatibilityGlobal?: string }
				).__quickAddEvalCompatibilityGlobal = previousGlobal;
			}
		}
	});

	it("preserves argument passing, return values, sensitive strings, and async errors", async () => {
		const app = createUserScriptApp(`
			module.exports = {
				settings: { mode: "private" },
				run: async (params, settings) => {
					if (params.shouldReject) throw new Error("script rejected");
					return {
						receivedToken: params.token,
						mode: settings.mode,
					};
				},
			};
		`);
		const command = createUserScriptCommand({
			name: "Script::run",
			settings: { mode: "user" },
		});

		const script = await getUserScript(command, app);
		expect(typeof script).toBe("function");

		await expect(
			(script as (params: unknown, settings: Record<string, unknown>) => unknown)(
				{ token: "sensitive-token" },
				command.settings,
			),
		).resolves.toEqual({
			receivedToken: "sensitive-token",
			mode: "user",
		});

		await expect(
			(script as (params: unknown, settings: Record<string, unknown>) => unknown)(
				{ shouldReject: true },
				command.settings,
			),
		).rejects.toThrow("script rejected");
	});
});

describe("getOpenFileOriginLeaf", () => {
	it("captures the most recent root-split leaf before tab creation", () => {
		const activeLeaf = createLeaf("active");
		const originLeaf = createLeaf("source");
		const { app, getMostRecentLeaf, rootSplit } = createApp({
			rootLeaves: [originLeaf],
			originLeaf: activeLeaf,
			mostRecentLeaf: originLeaf,
		});

		expect(getOpenFileOriginLeaf(app)).toBe(originLeaf);
		expect(getMostRecentLeaf).toHaveBeenCalledWith(rootSplit);
	});

	it("falls back to the most recent leaf when rootSplit is unavailable", () => {
		const activeLeaf = createLeaf("active");
		const originLeaf = createLeaf("source");
		const { app, getMostRecentLeaf } = createApp({
			rootLeaves: [originLeaf],
			originLeaf: activeLeaf,
			mostRecentLeaf: originLeaf,
			rootSplit: null,
		});

		expect(getOpenFileOriginLeaf(app)).toBe(originLeaf);
		expect(getMostRecentLeaf).toHaveBeenCalledWith();
	});
});

describe("openFile", () => {
	it("routes tab opens from a pinned origin into an unpinned sibling", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin", true);
		const unpinnedSiblingLeaf = createLeaf("unpinned-sibling");
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf, setActiveLeaf } = createApp({
			rootLeaves: [pinnedOriginLeaf, unpinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "tab",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(unpinnedSiblingLeaf);
		expect(unpinnedSiblingLeaf.openFile).toHaveBeenCalledWith(file);
		expect(tabLeaf.openFile).not.toHaveBeenCalled();
		expect(getLeaf).not.toHaveBeenCalledWith("tab");
		expect(setActiveLeaf).toHaveBeenCalledWith(unpinnedSiblingLeaf, {
			focus: true,
		});
	});

	it("routes away from a transient leaf in the pinned origin's tab group", async () => {
		const lockedGroup = { id: "locked-group" };
		const rightGroup = { id: "right-group" };
		const pinnedOriginLeaf = setParent(
			createLeaf("pinned-origin", true),
			lockedGroup,
		);
		const transientLeaf = setParent(createLeaf("transient"), lockedGroup);
		const unpinnedSiblingLeaf = setParent(
			createLeaf("unpinned-sibling"),
			rightGroup,
		);
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [transientLeaf, unpinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			activeLeaf: transientLeaf,
			mostRecentLeaf: transientLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "tab",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(unpinnedSiblingLeaf);
		expect(transientLeaf.openFile).not.toHaveBeenCalled();
		expect(unpinnedSiblingLeaf.openFile).toHaveBeenCalledWith(file);
		expect(getLeaf).not.toHaveBeenCalledWith("tab");
	});

	it("routes reuse opens from a pinned origin into an unpinned sibling", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin", true);
		const unpinnedSiblingLeaf = createLeaf("unpinned-sibling");
		const reuseLeaf = createLeaf("reuse");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [pinnedOriginLeaf, unpinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			reuseLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "reuse",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(unpinnedSiblingLeaf);
		expect(unpinnedSiblingLeaf.openFile).toHaveBeenCalledWith(file);
		expect(reuseLeaf.openFile).not.toHaveBeenCalled();
		expect(getLeaf).not.toHaveBeenCalledWith(false);
	});

	it("treats nested view-state pinning as pinned navigation state", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin");
		pinnedOriginLeaf.getViewState.mockReturnValue({
			type: "markdown",
			state: { file: "pinned-origin.md", pinned: true },
		});
		const unpinnedSiblingLeaf = createLeaf("unpinned-sibling");
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [pinnedOriginLeaf, unpinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "tab",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(unpinnedSiblingLeaf);
		expect(unpinnedSiblingLeaf.openFile).toHaveBeenCalledWith(file);
		expect(tabLeaf.openFile).not.toHaveBeenCalled();
		expect(getLeaf).not.toHaveBeenCalledWith("tab");
	});

	it("preserves normal tab behavior when the origin is not pinned", async () => {
		const unpinnedOriginLeaf = createLeaf("origin");
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [unpinnedOriginLeaf],
			originLeaf: unpinnedOriginLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "tab",
			originLeaf: unpinnedOriginLeaf,
		});

		expect(leaf).toBe(tabLeaf);
		expect(getLeaf).toHaveBeenCalledWith("tab");
		expect(tabLeaf.openFile).toHaveBeenCalledWith(file);
		expect(unpinnedOriginLeaf.openFile).not.toHaveBeenCalled();
	});

	it("falls back to normal tab creation when no unpinned sibling exists", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin", true);
		const pinnedSiblingLeaf = createLeaf("pinned-sibling", true);
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [pinnedOriginLeaf, pinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "tab",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(tabLeaf);
		expect(getLeaf).toHaveBeenCalledWith("tab");
		expect(tabLeaf.openFile).toHaveBeenCalledWith(file);
	});

	it("falls back to a new tab for reuse when no unpinned sibling exists", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin", true);
		const pinnedSiblingLeaf = createLeaf("pinned-sibling", true);
		const reuseLeaf = createLeaf("reuse");
		const tabLeaf = createLeaf("tab");
		const file = createFile();
		const { app, getLeaf } = createApp({
			rootLeaves: [pinnedOriginLeaf, pinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			reuseLeaf,
			tabLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "reuse",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(tabLeaf);
		expect(getLeaf).toHaveBeenCalledWith("tab");
		expect(getLeaf).not.toHaveBeenCalledWith(false);
		expect(tabLeaf.openFile).toHaveBeenCalledWith(file);
		expect(reuseLeaf.openFile).not.toHaveBeenCalled();
	});

	it("leaves explicit split behavior unchanged for pinned origins", async () => {
		const pinnedOriginLeaf = createLeaf("pinned-origin", true);
		const unpinnedSiblingLeaf = createLeaf("unpinned-sibling");
		const splitLeaf = createLeaf("split");
		const file = createFile();
		const { app, getLeaf, iterateRootLeaves } = createApp({
			rootLeaves: [pinnedOriginLeaf, unpinnedSiblingLeaf],
			originLeaf: pinnedOriginLeaf,
			splitLeaf,
		});

		const leaf = await openFile(app, file, {
			location: "split",
			direction: "horizontal",
			originLeaf: pinnedOriginLeaf,
		});

		expect(leaf).toBe(splitLeaf);
		expect(getLeaf).toHaveBeenCalledWith("split", "horizontal");
		expect(iterateRootLeaves).not.toHaveBeenCalled();
		expect(unpinnedSiblingLeaf.openFile).not.toHaveBeenCalled();
		expect(splitLeaf.openFile).toHaveBeenCalledWith(file);
	});
});

describe("normalizeVaultFilePath", () => {
	it("normalizes redundant separators", () => {
		expect(normalizeVaultFilePath("notes//capture.md")).toBe(
			"notes/capture.md",
		);
	});

	it("removes leading slashes", () => {
		expect(normalizeVaultFilePath("/notes/capture.md")).toBe(
			"notes/capture.md",
		);
	});

	it("normalizes windows path separators", () => {
		expect(normalizeVaultFilePath("notes\\\\capture.md")).toBe(
			"notes/capture.md",
		);
	});
});

describe("areSameVaultFilePath", () => {
	it("matches logically equivalent vault paths", () => {
		expect(areSameVaultFilePath("notes//capture.md", "notes/capture.md")).toBe(
			true,
		);
		expect(areSameVaultFilePath("/notes/capture.md", "notes/capture.md")).toBe(
			true,
		);
	});

	it("keeps case-sensitive mismatches distinct", () => {
		expect(areSameVaultFilePath("notes/Foo.md", "notes/foo.md")).toBe(false);
	});
});

describe("insertIntoFrontmatterProperty ", () => {

	describe("alwaysAppend", () => {
		const frontmatterHandling = "alwaysAppend";

		it("should create a property if it does not exist", () => {
			let frontmatter = {};
			let result = {foo: ["bar"]}
			insertIntoFrontmatterProperty(frontmatter, "foo", "bar", frontmatterHandling)
			expect(frontmatter).toEqual(result)
		})

		it("should create a property if it is null or undefined", () => {
			let frontmatter = {fooNull: null, fooUndefined: undefined};
			let result = {fooNull: ["bar"], fooUndefined: ["baz"]};
			insertIntoFrontmatterProperty(frontmatter, "fooNull", "bar", frontmatterHandling)
			insertIntoFrontmatterProperty(frontmatter, "fooUndefined", "baz", frontmatterHandling)
			expect(frontmatter).toEqual(result)
		})

		it("should convert text scalars and other non object types into arrays", () => {
			let frontmatter = {int: 10, text: "Hello World!"};
			let result = {int: [10, "bar"], text: ["Hello World!", "baz"]}
			insertIntoFrontmatterProperty(frontmatter, "int", "bar", frontmatterHandling)
			insertIntoFrontmatterProperty(frontmatter, "text", "baz", frontmatterHandling)
			expect(frontmatter).toEqual(result)
		})

		it("should append values to existing arrays", () => {
			let frontmatter = {list: [1, "2"]}
			let result = {list: [1, "2", "three"]}
			insertIntoFrontmatterProperty(frontmatter, "list", "three", frontmatterHandling);
			expect(frontmatter).toEqual(result)
		})

		it("should error when trying to overwrite an object and keep the frontmatter unchanged", () => {
			let frontmatter = {data: {list: [1, "2"], value: "Hello World!"}}
			let result = {data: {list: [1, "2"], value: "Hello World!"}}
			expect(() => insertIntoFrontmatterProperty(frontmatter, "data", "bar", frontmatterHandling)).toThrowError()
			expect(frontmatter).toEqual(result)
		})

		it("should error on empty frontmatterProperty", () => {
			let frontmatter = {list: [1, "2"]}
			let result = {list: [1, "2"]}
			expect(() => insertIntoFrontmatterProperty(frontmatter, "", "bar", frontmatterHandling)).toThrowError()
			expect(frontmatter).toEqual(result)
		})

	})


	describe("createProperty", () => {
		const frontmatterType = "createProperty"

		it("should create a property if it does not exist", () => {
			let frontmatter = {};
			let result = {foo: ["bar"]}
			insertIntoFrontmatterProperty(frontmatter, "foo", "bar", frontmatterType)
			expect(frontmatter).toEqual(result)
		})

		it("should create a property if it is null or undefined", () => {
			let frontmatter = {fooNull: null, fooUndefined: undefined};
			let result = {fooNull: ["bar"], fooUndefined: ["baz"]};
			insertIntoFrontmatterProperty(frontmatter, "fooNull", "bar", frontmatterType)
			insertIntoFrontmatterProperty(frontmatter, "fooUndefined", "baz", frontmatterType)
			expect(frontmatter).toEqual(result)
		})

		it("should error on non array types", () => {
			let frontmatter = {int: 10, text: "Hello World!"};
			let result = {int: 10, text: "Hello World!"};
			expect(() => insertIntoFrontmatterProperty(frontmatter, "int", "bar", frontmatterType)).toThrow()
			expect(() => insertIntoFrontmatterProperty(frontmatter, "text", "baz", frontmatterType)).toThrow()
			expect(frontmatter).toEqual(result)
		})

		it("should append values to existing arrays", () => {
			let frontmatter = {list: [1, "2"]}
			let result = {list: [1, "2", "three"]}
			insertIntoFrontmatterProperty(frontmatter, "list", "three", frontmatterType);
			expect(frontmatter).toEqual(result)
		})

		it("should error when trying to overwrite an object and keep the frontmatter unchanged", () => {
			let frontmatter = {data: {list: [1, "2"], value: "Hello World!"}}
			let result = {data: {list: [1, "2"], value: "Hello World!"}}
			expect(() => insertIntoFrontmatterProperty(frontmatter, "data", "bar", frontmatterType)).toThrowError()
			expect(frontmatter).toEqual(result)
		})

		it("should error on empty frontmatterProperty", () => {
			let frontmatter = {list: [1, "2"]}
			let result = {list: [1, "2"]}
			expect(() => insertIntoFrontmatterProperty(frontmatter, "", "bar", frontmatterType)).toThrowError()
			expect(frontmatter).toEqual(result)
		})

	})


	describe("error", () => {
		const frontmatterType = "error"
		it("should error if a property does not exist", () => {
			let frontmatter = {};
			let result = {}
			expect(() => insertIntoFrontmatterProperty(frontmatter, "foo", "bar", frontmatterType)).toThrow()
			expect(frontmatter).toEqual(result)
		})

		it("should create a property if it is null but throw error if undefined", () => {
			let frontmatter = {fooNull: null, fooUndefined: undefined};
			let result = {fooNull: ["bar"], fooUndefined: undefined};
			expect(() => insertIntoFrontmatterProperty(frontmatter, "fooNull", "bar", frontmatterType)).not.toThrow()
			expect(() => insertIntoFrontmatterProperty(frontmatter, "fooUndefined", "baz", frontmatterType)).toThrow()
			expect(frontmatter).toEqual(result)
		})

		it("should error on scalars and other non object types", () => {
			let frontmatter = {int: 10, text: "Hello World!"};
			let result = {int: 10, text: "Hello World!"};
			expect(() => insertIntoFrontmatterProperty(frontmatter, "int", "bar", frontmatterType)).toThrow()
			expect(() => insertIntoFrontmatterProperty(frontmatter, "text", "baz", frontmatterType)).toThrow()
			expect(frontmatter).toEqual(result)
		})

		it("should append values to existing arrays", () => {
			let frontmatter = {list: [1, "2"]}
			let result = {list: [1, "2", "three"]}
			insertIntoFrontmatterProperty(frontmatter, "list", "three", frontmatterType);
			expect(frontmatter).toEqual(result)
		})

		it("should error when trying to overwrite an object and keep the frontmatter unchanged", () => {
			let frontmatter = {data: {list: [1, "2"], value: "Hello World!"}}
			let result = {data: {list: [1, "2"], value: "Hello World!"}}
			expect(() => insertIntoFrontmatterProperty(frontmatter, "data", "bar", frontmatterType)).toThrowError()
			expect(frontmatter).toEqual(result)
		})

		it("should error on empty frontmatterProperty", () => {
			let frontmatter = {list: [1, "2"]}
			let result = {list: [1, "2"]}
			expect(() => insertIntoFrontmatterProperty(frontmatter, "", "bar", frontmatterType)).toThrowError()
			expect(frontmatter).toEqual(result)
		})
	})
})
