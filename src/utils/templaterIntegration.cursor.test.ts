import { App, TFile, type EventRef, type MarkdownView } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { overwriteTemplaterOnce } from "./templaterIntegration";

function setup() {
	const app = new App();
	const file = Object.assign(new TFile(), { path: "note.md", extension: "md" });
	let content = "<% rendered %>";
	let onOverwrite: (event: { file: TFile; content: string }) => void = () => {};
	const listener = {} as EventRef;
	app.workspace.on = vi.fn((_name, callback) => {
		onOverwrite = callback;
		return listener;
	});
	app.workspace.offref = vi.fn();
	app.vault.read = vi.fn(async () => content);
	app.vault.modify = vi.fn(async (_file, value) => { content = value; });
	vi.spyOn(app.workspace, "getActiveViewOfType").mockReturnValue({
		file,
		editor: { getValue: () => content, getCursor: () => ({ line: 0, ch: 0 }) },
	} as MarkdownView);
	const overwrite = vi.fn(async () => {});
	Object.assign(app.plugins.plugins, {
		"templater-obsidian": { templater: { overwrite_file_commands: overwrite } },
	});
	return {
		app, file, overwrite, listener,
		emit: (rendered: string, target = file) => onOverwrite({ file: target, content: rendered }),
		write: (value: string) => { content = value; },
	};
}

describe("Templater native overwrite cursor ownership", () => {
	it.each(["", "1", "-1", "0.5", "-0.5"])("recognizes a consumed cursor at unchanged position with order %s", async order => {
		const h = setup();
		h.overwrite.mockImplementation(async () => {
			h.emit(`<% tp.file.cursor(${order}) %>body{{CURSOR}}`);
			h.write("body{{CURSOR}}");
		});
		expect(await overwriteTemplaterOnce(h.app, h.file)).toBe(true);
		expect(h.app.workspace.offref).toHaveBeenCalledExactlyOnceWith(h.listener);
	});

	it("does not claim an unconsumed marker", async () => {
		const h = setup();
		h.overwrite.mockImplementation(async () => {
			const rendered = "<% tp.file.cursor(1) %>body";
			h.emit(rendered);
			h.write(rendered);
		});
		expect(await overwriteTemplaterOnce(h.app, h.file)).toBe(false);
	});

	it("ignores another file's native overwrite event", async () => {
		const h = setup();
		h.overwrite.mockImplementation(async () => {
			h.emit("<% tp.file.cursor() %>body", Object.assign(new TFile(), { path: "other.md" }));
			h.write("body");
		});
		expect(await overwriteTemplaterOnce(h.app, h.file)).toBe(false);
	});

	it("removes its listener and rolls back when native rendering fails", async () => {
		const h = setup();
		h.overwrite.mockRejectedValueOnce(new Error("render failed"));
		expect(await overwriteTemplaterOnce(h.app, h.file)).toBe(false);
		expect(h.app.workspace.offref).toHaveBeenCalledExactlyOnceWith(h.listener);
		expect(h.app.vault.modify).toHaveBeenCalledWith(h.file, "<% rendered %>");
	});
});
