import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import {
	getCanvasActionUnsupportedReason,
	getCanvasTextCaptureContent,
	resolveActiveCanvasCaptureTarget,
	resolveConfiguredCanvasCaptureTarget,
	setCanvasTextCaptureContent,
} from "./canvasCapture";
import type { CaptureAction } from "./captureAction";

function createApp(overrides: Record<string, unknown> = {}): App {
	const app = {
		workspace: {
			activeLeaf: {
				view: {
					getViewType: () => "markdown",
				},
			},
			getActiveFile: () => ({ path: "Canvas.canvas", basename: "Canvas" }),
		},
		vault: {
			getAbstractFileByPath: () => null,
			read: async () => "",
			modify: async () => {},
		},
		...overrides,
	};

	return app as unknown as App;
}

describe("canvasCapture", () => {
	it("returns null when active view is not canvas", () => {
		const target = resolveActiveCanvasCaptureTarget(
			createApp(),
			"activeFileTop",
		);
		expect(target).toBeNull();
	});

	it("requires exactly one selected node", () => {
		const app = createApp({
			workspace: {
				activeLeaf: {
					view: {
						getViewType: () => "canvas",
						file: { path: "Canvas.canvas", basename: "Canvas" },
						canvas: {
							selection: new Set(),
						},
					},
				},
				getActiveFile: () => ({ path: "Canvas.canvas", basename: "Canvas" }),
			},
		});

		expect(() => resolveActiveCanvasCaptureTarget(app, "activeFileTop")).toThrow(
			"exactly one selected node",
		);
	});

	it("rejects unsupported cursor action for text cards", () => {
		const app = createApp({
			workspace: {
				activeLeaf: {
					view: {
						getViewType: () => "canvas",
						file: { path: "Canvas.canvas", basename: "Canvas" },
						canvas: {
							selection: new Set([{ type: "text", text: "body" }]),
						},
					},
				},
				getActiveFile: () => ({ path: "Canvas.canvas", basename: "Canvas" }),
			},
		});

		expect(() => resolveActiveCanvasCaptureTarget(app, "currentLine")).toThrow(
			"At cursor",
		);
	});

	it("rejects unsupported cursor action for file cards", () => {
		const app = createApp({
			workspace: {
				activeLeaf: {
					view: {
						getViewType: () => "canvas",
						file: { path: "Canvas.canvas", basename: "Canvas" },
						canvas: {
							selection: new Set([
								{ type: "file", file: { path: "Folder/Note.md" } },
							]),
						},
					},
				},
				getActiveFile: () => ({ path: "Canvas.canvas", basename: "Canvas" }),
			},
		});

		expect(() => resolveActiveCanvasCaptureTarget(app, "currentLine")).toThrow(
			"cursor-based capture modes",
		);
	});

	it("resolves markdown file card targets", () => {
		const markdownFile = {
			path: "Folder/Note.md",
			basename: "Note",
			extension: "md",
		};
		const app = createApp({
			workspace: {
				activeLeaf: {
					view: {
						getViewType: () => "canvas",
						file: { path: "Canvas.canvas", basename: "Canvas" },
						canvas: {
							selection: new Set([
								{ type: "file", file: { path: "Folder/Note.md" } },
							]),
						},
					},
				},
				getActiveFile: () => ({ path: "Canvas.canvas", basename: "Canvas" }),
			},
			vault: {
				getAbstractFileByPath: (path: string) =>
					path === "Folder/Note.md" ? (markdownFile as any) : null,
				read: async () => "",
				modify: async () => {},
			},
		});

		const target = resolveActiveCanvasCaptureTarget(app, "prepend");
		expect(target).not.toBeNull();
		expect(target?.kind).toBe("file");
		if (target?.kind === "file") {
			expect(target.canvasFile.path).toBe("Canvas.canvas");
			expect(target.targetFile.path).toBe("Folder/Note.md");
			expect(target.targetFile.path).not.toBe(target.canvasFile.path);
		}
	});

	it("resolves markdown file card targets with uppercase .MD extension", () => {
		const markdownFile = {
			path: "Folder/Note.MD",
			basename: "Note",
			extension: "md",
		};
		const app = createApp({
			workspace: {
				activeLeaf: {
					view: {
						getViewType: () => "canvas",
						file: { path: "Canvas.canvas", basename: "Canvas" },
						canvas: {
							selection: new Set([
								{ type: "file", file: { path: "Folder/Note.MD" } },
							]),
						},
					},
				},
				getActiveFile: () => ({ path: "Canvas.canvas", basename: "Canvas" }),
			},
			vault: {
				getAbstractFileByPath: (path: string) =>
					path === "Folder/Note.MD" ? (markdownFile as any) : null,
				read: async () => "",
				modify: async () => {},
			},
		});

		const target = resolveActiveCanvasCaptureTarget(app, "prepend");
		expect(target).not.toBeNull();
		expect(target?.kind).toBe("file");
		if (target?.kind === "file") {
			expect(target.targetFile.path).toBe("Folder/Note.MD");
		}
	});

	it("rejects non-markdown file card targets", () => {
		const canvasFile = {
			path: "Folder/Other.canvas",
			basename: "Other",
			extension: "canvas",
		};
		const app = createApp({
			workspace: {
				activeLeaf: {
					view: {
						getViewType: () => "canvas",
						file: { path: "Canvas.canvas", basename: "Canvas" },
						canvas: {
							selection: new Set([
								{ type: "file", file: { path: "Folder/Other.canvas" } },
							]),
						},
					},
				},
				getActiveFile: () => ({ path: "Canvas.canvas", basename: "Canvas" }),
			},
			vault: {
				getAbstractFileByPath: (path: string) =>
					path === "Folder/Other.canvas" ? (canvasFile as any) : null,
				read: async () => "",
				modify: async () => {},
			},
		});

		expect(() => resolveActiveCanvasCaptureTarget(app, "prepend")).toThrow(
			"markdown files only",
		);
	});

	it("resolves configured .canvas node targets by id", async () => {
		const canvasFile = {
			path: "Boards/Plan.canvas",
			basename: "Plan",
			extension: "canvas",
		};
		const app = createApp({
			vault: {
				getAbstractFileByPath: (path: string) =>
					path === "Boards/Plan.canvas" ? (canvasFile as any) : null,
				read: async () =>
					JSON.stringify({
						nodes: [
							{ id: "t1", type: "text", text: "Current" },
						],
					}),
				modify: async () => {},
			},
		});

		const target = await resolveConfiguredCanvasCaptureTarget(
			app,
			"Boards/Plan.canvas",
			"t1",
			"append",
		);

		expect(target.kind).toBe("text");
		if (target.kind === "text") {
			expect(getCanvasTextCaptureContent(target)).toBe("Current");
		}
	});

	it("updates configured canvas text nodes and persists file", async () => {
		const canvasFile = {
			path: "Boards/Plan.canvas",
			basename: "Plan",
			extension: "canvas",
		};
		let modified = "";
		const app = createApp({
			vault: {
				getAbstractFileByPath: (path: string) =>
					path === "Boards/Plan.canvas" ? (canvasFile as any) : null,
				read: async () =>
					JSON.stringify({
						nodes: [
							{ id: "t1", type: "text", text: "Current" },
						],
					}),
				modify: async (_file: unknown, content: string) => {
					modified = content;
				},
			},
		});

		const target = await resolveConfiguredCanvasCaptureTarget(
			app,
			"Boards/Plan.canvas",
			"t1",
			"append",
		);
		expect(target.kind).toBe("text");
		if (target.kind !== "text") return;

		await setCanvasTextCaptureContent(app, target, "Updated");
		const updated = JSON.parse(modified) as {
			nodes: Array<{ id: string; text: string }>;
		};
		expect(updated.nodes[0].id).toBe("t1");
		expect(updated.nodes[0].text).toBe("Updated");
		expect(modified).toContain('\t"nodes": [');
		expect(modified).not.toContain('  "nodes": [');
	});

	it("aborts configured text-node write when canvas changed concurrently", async () => {
		const canvasFile = {
			path: "Boards/Plan.canvas",
			basename: "Plan",
			extension: "canvas",
		};
		let modifyCalls = 0;
		let readCalls = 0;
		const initial = JSON.stringify({
			nodes: [{ id: "t1", type: "text", text: "Current" }],
		});
		const changed = JSON.stringify({
			nodes: [{ id: "t1", type: "text", text: "Changed elsewhere" }],
		});

		const app = createApp({
			vault: {
				getAbstractFileByPath: (path: string) =>
					path === "Boards/Plan.canvas" ? (canvasFile as any) : null,
				read: async () => {
					readCalls += 1;
					return readCalls === 1 ? initial : changed;
				},
				modify: async () => {
					modifyCalls += 1;
				},
			},
		});

		const target = await resolveConfiguredCanvasCaptureTarget(
			app,
			"Boards/Plan.canvas",
			"t1",
			"append",
		);
		expect(target.kind).toBe("text");
		if (target.kind !== "text") return;

		await expect(
			setCanvasTextCaptureContent(app, target, "Updated"),
		).rejects.toThrow("Canvas target changed while capture was running");
		expect(modifyCalls).toBe(0);
	});

	it("fails configured canvas capture when node id does not exist", async () => {
		const canvasFile = {
			path: "Boards/Plan.canvas",
			basename: "Plan",
			extension: "canvas",
		};
		const app = createApp({
			vault: {
				getAbstractFileByPath: (path: string) =>
					path === "Boards/Plan.canvas" ? (canvasFile as any) : null,
				read: async () => JSON.stringify({ nodes: [] }),
				modify: async () => {},
			},
		});

		await expect(
			resolveConfiguredCanvasCaptureTarget(
				app,
				"Boards/Plan.canvas",
				"missing-node",
				"append",
			),
		).rejects.toThrow("was not found");
	});


	it("reports unsupported reasons by action", () => {
		expect(
			getCanvasActionUnsupportedReason("text", "currentLine" as CaptureAction),
		).toContain("At cursor");
		expect(
			getCanvasActionUnsupportedReason("text", "insertAfter" as CaptureAction),
		).toBeNull();
		expect(
			getCanvasActionUnsupportedReason("file", "newLineBelow" as CaptureAction),
		).toContain("cursor-based");
		expect(
			getCanvasActionUnsupportedReason("file", "prepend" as CaptureAction),
		).toBeNull();
	});
});
