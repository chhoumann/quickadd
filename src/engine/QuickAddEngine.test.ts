import { describe, expect, it, vi } from "vitest";
import { QuickAddEngine } from "./QuickAddEngine";

class TestEngine extends QuickAddEngine {
	public constructor() {
		super({} as any);
	}

	public normalize(folderPath: string, fileName: string): string {
		return this.normalizeMarkdownFilePath(folderPath, fileName);
	}

	public run(): void {}
}

describe("QuickAddEngine path normalization", () => {
	const engine = new TestEngine();

	it("strips leading slashes from folder and file", () => {
		expect(engine.normalize("/daily", "/note")).toBe("daily/note.md");
	});

	it("strips leading slashes from file-only paths", () => {
		expect(engine.normalize("", "/review/daily")).toBe("review/daily.md");
	});
});

class SinkTestEngine extends QuickAddEngine {
	public readonly created: Array<{ path: string; content: string }> = [];
	public readonly createdFolders: string[] = [];

	public constructor() {
		const app = {
			vault: {
				adapter: { exists: vi.fn().mockResolvedValue(false) },
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
				createFolder: vi.fn(async (folder: string) => {
					(this as SinkTestEngine).createdFolders.push(folder);
				}),
				create: vi.fn(async (path: string, content: string) => {
					const file = { path, basename: path };
					(this as SinkTestEngine).created.push({ path, content });
					return file;
				}),
			},
		};
		super(app as any);
	}

	public create(path: string, content: string) {
		return this.createFileWithInput(path, content);
	}

	public run(): void {}
}

describe("QuickAddEngine createFileWithInput vault containment", () => {
	// Every assembled path that resolves OUTSIDE the vault must be rejected at the
	// create sink before any filesystem touch (folder creation or vault.create).
	const escaping = [
		"..\\..\\..\\evil.md", // Windows-style backslash traversal (the URI/{{VALUE}} vector)
		"../../../evil.md", // POSIX traversal
		"folder/../../evil.md", // traversal mid-path
		"/etc/evil.md", // POSIX-absolute
		"C:/evil.md", // Windows drive-absolute
		"C:\\evil.md", // Windows drive-absolute, backslash
		"\\\\server\\share\\evil.md", // UNC
	];

	for (const path of escaping) {
		it(`refuses to create an out-of-vault path: ${JSON.stringify(path)}`, async () => {
			const engine = new SinkTestEngine();
			await expect(engine.create(path, "payload")).rejects.toThrow(
				/Refusing to create a file outside the vault/,
			);
			// The write AND the folder pre-creation must never have run.
			expect(engine.created).toHaveLength(0);
			expect(engine.createdFolders).toHaveLength(0);
		});
	}

	it("still creates ordinary in-vault paths", async () => {
		const engine = new SinkTestEngine();
		const file = await engine.create("Projects/Notes/Issue 221.md", "body");
		expect(file.path).toBe("Projects/Notes/Issue 221.md");
		expect(engine.created).toEqual([
			{ path: "Projects/Notes/Issue 221.md", content: "body" },
		]);
	});

	it("allows in-vault config-dir paths (escapesVaultBoundary only blocks escapes)", async () => {
		const engine = new SinkTestEngine();
		const file = await engine.create(".obsidian/snippets/note.md", "body");
		expect(file.path).toBe(".obsidian/snippets/note.md");
	});
});
