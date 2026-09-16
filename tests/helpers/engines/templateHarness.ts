import { vi } from "vitest";
import { TFile, TFolder, type App, parseYaml } from "obsidian";
import type QuickAdd from "src/main";
import { TemplateEngine } from "src/engine/TemplateEngine";
import { SingleTemplateEngine } from "src/engine/SingleTemplateEngine";
import { CompleteFormatter } from "src/formatters/completeFormatter";
import { createChoiceExecutor } from "../createChoiceExecutor";

class TemplateProbe extends TemplateEngine {
	constructor(app: App, plugin: QuickAdd, executor: ReturnType<typeof createChoiceExecutor>) {
		super(app, plugin, executor);
	}
	async run() { }
	get bodyFormatter() { return this.formatter; }
	create = this.createFileWithTemplate.bind(this);
	overwrite = this.overwriteFileWithTemplate.bind(this);
	append = this.appendToFileWithTemplate.bind(this);
}

export function templateHarness(enabled = true) {
	const files = new Map<string, TFile>();
	const contents = new Map<string, string>();
	const events: string[] = [];
	const properties = new Map<string, Record<string, unknown>>();
	const root = Object.assign(new TFolder(), { path: "", name: "" });
	function file(path: string, content = "") {
		const name = path.split("/").pop() ?? path;
		const extension = name.split(".").pop() ?? "";
		const result = Object.assign(new TFile(), {
			path, name, extension, basename: name.slice(0, -(extension.length + 1)), parent: root,
		});
		files.set(path, result);
		contents.set(path, content);
		return result;
	}
	const vault = {
		getAbstractFileByPath: vi.fn((path: string) => path === "" ? root : files.get(path) ?? null),
		getFileByPath: vi.fn((path: string) => files.get(path) ?? null),
		getFiles: vi.fn(() => [...files.values()]),
		getMarkdownFiles: vi.fn(() => [...files.values()].filter((f) => f.extension === "md")),
		adapter: { exists: vi.fn(async (path: string) => files.has(path) || path === "") },
		createFolder: vi.fn(async () => root),
		cachedRead: vi.fn(async (f: TFile) => contents.get(f.path) ?? ""),
		read: vi.fn(async (f: TFile) => contents.get(f.path) ?? ""),
		create: vi.fn(async (path: string, content: string) => {
			events.push("create");
			return file(path, content);
		}),
		modify: vi.fn(async (f: TFile, content: string) => {
			events.push("modify");
			contents.set(f.path, content);
		}),
	};
	function frontmatter(f: TFile): Record<string, unknown> {
		const written = properties.get(f.path);
		if (written) return written;
		const yaml = contents.get(f.path)?.match(/^---\n([\s\S]*?)\n---/);
		return yaml ? parseYaml(yaml[1]) ?? {} : {};
	}
	const processFrontMatter = vi.fn(async (f: TFile, update: (fm: Record<string, unknown>) => void) => {
		events.push("properties");
		const fm = frontmatter(f);
		update(fm);
		properties.set(f.path, fm);
		const body = (contents.get(f.path) ?? "").replace(/^---\n[\s\S]*?\n---\n?/, "");
		contents.set(f.path, `---\n${Object.entries(fm).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n")}\n---\n${body}`);
	});
	const app = {
		vault, fileManager: { processFrontMatter },
		workspace: { getActiveFile: () => null, getActiveViewOfType: () => null },
		metadataCache: { getFileCache: () => null },
		plugins: { plugins: {} },
	} as unknown as App;
	const plugin = { settings: { enableTemplatePropertyTypes: enabled, globalVariables: {} } } as QuickAdd;
	const executor = createChoiceExecutor();
	const engine = new TemplateProbe(app, plugin, executor);
	const formatter = new CompleteFormatter(app, plugin, executor);
	return {
		app, plugin, executor, engine, formatter, file, vault, contents, events,
		frontmatter, processFrontMatter,
		single: (path: string) => new SingleTemplateEngine(app, plugin, path, executor),
	};
}
