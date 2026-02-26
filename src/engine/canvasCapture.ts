import type { App, TAbstractFile, TFile } from "obsidian";
import {
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../constants";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import type { CaptureAction } from "./captureAction";

type CanvasDataNodeLike = {
	id?: string;
	type?: string;
	text?: string;
	file?: string | { path?: string };
};

type CanvasNodeLike = {
	id?: string;
	type?: string;
	text?: string;
	setText?: (text: string) => void;
	file?: string | TFile | { path?: string };
};

type CanvasLike = {
	selection?: Set<CanvasNodeLike>;
	requestSave?: () => void;
	getData?: () => { nodes?: CanvasDataNodeLike[] };
};

type CanvasViewLike = {
	file?: TFile;
	canvas?: CanvasLike;
	getViewType?: () => string;
};

type WorkspaceLeafLike = {
	view?: CanvasViewLike;
};

type WorkspaceLike = {
	getMostRecentLeaf?: () => WorkspaceLeafLike | null;
	activeLeaf?: WorkspaceLeafLike | null;
	getActiveFile?: () => TFile | null;
};

type CanvasAppLike = {
	workspace: WorkspaceLike;
	vault: {
		getAbstractFileByPath: (path: string) => TAbstractFile | null;
	};
};

type StoredCanvasData = {
	nodes: CanvasDataNodeLike[];
	[key: string]: unknown;
};

export type CanvasCaptureTarget =
	| {
			kind: "text";
			source: "active";
			canvas: CanvasLike;
			canvasFile: TFile;
			node: CanvasNodeLike;
			nodeData: CanvasDataNodeLike | null;
	  }
	| {
			kind: "file";
			source: "active";
			canvasFile: TFile;
			node: CanvasNodeLike;
			targetFile: TFile;
	  };

export type ConfiguredCanvasCaptureTarget =
	| {
			kind: "text";
			source: "configured";
			canvasFile: TFile;
			rawCanvas: string;
			canvasData: StoredCanvasData;
			nodeData: CanvasDataNodeLike;
			nodeIndex: number;
	  }
	| {
			kind: "file";
			source: "configured";
			canvasFile: TFile;
			nodeData: CanvasDataNodeLike;
			targetPath: string;
			targetFile?: TFile;
	  };

export type CanvasTextCaptureTarget =
	| Extract<CanvasCaptureTarget, { kind: "text" }>
	| Extract<ConfiguredCanvasCaptureTarget, { kind: "text" }>;

function getNodeKind(
	node: CanvasNodeLike | CanvasDataNodeLike,
): "text" | "file" | "unsupported" {
	if (node?.type === "text") return "text";
	if (node?.type === "file") return "file";
	if (node?.file) return "file";
	if (typeof node?.text === "string") return "text";
	return "unsupported";
}

function getCanvasNodeDataById(
	canvas: CanvasLike,
	node: CanvasNodeLike,
): CanvasDataNodeLike | null {
	const nodeId = node.id;
	if (!nodeId) return null;

	const canvasData = canvas.getData?.();
	if (!canvasData?.nodes?.length) return null;

	return canvasData.nodes.find((n) => n.id === nodeId) ?? null;
}

export function getCanvasActionUnsupportedReason(
	nodeKind: "text" | "file",
	action: CaptureAction,
): string | null {
	if (nodeKind === "text") {
		if (action === "currentLine") {
			return "Canvas capture does not support 'At cursor' for text cards. Use top, bottom, or insert-after placement.";
		}

		if (action === "newLineAbove" || action === "newLineBelow") {
			return "Canvas capture does not support 'New line above/below cursor' for text cards. Use top, bottom, or insert-after placement.";
		}
	}

	if (nodeKind === "file") {
		if (
			action === "currentLine" ||
			action === "newLineAbove" ||
			action === "newLineBelow"
		) {
			return "Canvas file cards do not support cursor-based capture modes. Use top, bottom, or insert-after modes.";
		}
	}

	return null;
}

function resolveCanvasNodeFilePath(
	node: CanvasNodeLike | CanvasDataNodeLike,
): string | null {
	const file = node.file;
	if (!file) return null;

	if (typeof file === "string") return file;
	if (
		typeof file === "object" &&
		"path" in file &&
		typeof file.path === "string"
	) {
		return file.path;
	}

	return null;
}

function isTFileLike(file: TAbstractFile | null): file is TFile {
	return !!file && "path" in file && "extension" in file;
}

function getActiveCanvasView(app: CanvasAppLike): CanvasViewLike | null {
	const preferredLeaf =
		app.workspace.activeLeaf ?? app.workspace.getMostRecentLeaf?.() ?? null;
	const activeView = preferredLeaf?.view;
	if (!activeView || activeView.getViewType?.() !== "canvas") return null;
	return activeView;
}

function getCanvasFile(app: CanvasAppLike, view: CanvasViewLike): TFile {
	const canvasFile = view.file ?? app.workspace.getActiveFile?.();
	if (!canvasFile) {
		throw new ChoiceAbortError(
			"Cannot capture to Canvas because no active Canvas file is available.",
		);
	}

	return canvasFile;
}

function getSingleSelectedCanvasNode(canvas: CanvasLike): CanvasNodeLike {
	const selected = canvas.selection ? Array.from(canvas.selection) : [];
	if (selected.length !== 1) {
		throw new ChoiceAbortError(
			"Canvas capture requires exactly one selected node.",
		);
	}

	return selected[0];
}

function resolveCanvasFileTargetPath(
	node: CanvasNodeLike | CanvasDataNodeLike,
): string {
	const linkedPath = resolveCanvasNodeFilePath(node);
	if (!linkedPath) {
		throw new ChoiceAbortError(
			"Selected Canvas file card does not have a valid linked file path.",
		);
	}

	if (!MARKDOWN_FILE_EXTENSION_REGEX.test(linkedPath)) {
		throw new ChoiceAbortError(
			"Canvas file card targets markdown files only in this version.",
		);
	}

	return linkedPath;
}

function resolveActiveCanvasFileTarget(
	app: CanvasAppLike,
	node: CanvasNodeLike | CanvasDataNodeLike,
): TFile {
	const targetPath = resolveCanvasFileTargetPath(node);
	const linked = app.vault.getAbstractFileByPath(targetPath);
	if (!isTFileLike(linked)) {
		throw new ChoiceAbortError(
			`Selected Canvas file card target not found: ${targetPath}`,
		);
	}

	return linked;
}

function resolveConfiguredCanvasFileTarget(
	app: CanvasAppLike,
	node: CanvasNodeLike | CanvasDataNodeLike,
): { targetPath: string; targetFile?: TFile } {
	const targetPath = resolveCanvasFileTargetPath(node);
	const linked = app.vault.getAbstractFileByPath(targetPath);
	if (!linked) {
		return { targetPath };
	}

	if (!isTFileLike(linked)) {
		throw new ChoiceAbortError(
			`Selected Canvas file card target not found: ${targetPath}`,
		);
	}

	return {
		targetPath,
		targetFile: linked,
	};
}

function parseStoredCanvasData(raw: string, path: string): StoredCanvasData {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new ChoiceAbortError(`Canvas file is not valid JSON: ${path}`);
	}

	if (!parsed || typeof parsed !== "object") {
		throw new ChoiceAbortError(`Canvas file has invalid structure: ${path}`);
	}

	const maybeData = parsed as { nodes?: unknown };
	if (!Array.isArray(maybeData.nodes)) {
		throw new ChoiceAbortError(
			`Canvas file has no nodes array: ${path}`,
		);
	}

	return parsed as StoredCanvasData;
}

export function resolveActiveCanvasCaptureTarget(
	app: App,
	action: CaptureAction,
): CanvasCaptureTarget | null {
	const canvasApp = app as unknown as CanvasAppLike;
	const view = getActiveCanvasView(canvasApp);
	if (!view) return null;

	const canvas = view.canvas;
	if (!canvas) {
		throw new ChoiceAbortError(
			"Canvas capture is unavailable in this Obsidian version.",
		);
	}

	const canvasFile = getCanvasFile(canvasApp, view);
	const selectedNode = getSingleSelectedCanvasNode(canvas);
	const selectedNodeData = getCanvasNodeDataById(canvas, selectedNode);

	let nodeKind = getNodeKind(selectedNode);
	if (nodeKind === "unsupported" && selectedNodeData) {
		nodeKind = getNodeKind(selectedNodeData);
	}

	if (nodeKind === "unsupported") {
		throw new ChoiceAbortError(
			"Canvas capture currently supports only text and file cards.",
		);
	}

	const unsupportedReason = getCanvasActionUnsupportedReason(nodeKind, action);
	if (unsupportedReason) {
		throw new ChoiceAbortError(unsupportedReason);
	}

	if (nodeKind === "text") {
		return {
			kind: "text",
			source: "active",
			canvas,
			canvasFile,
			node: selectedNode,
			nodeData: selectedNodeData,
		};
	}

	const fileBackedNode =
		selectedNode.file || !selectedNodeData?.file
			? selectedNode
			: { ...selectedNode, file: selectedNodeData.file };

	return {
		kind: "file",
		source: "active",
		canvasFile,
		node: fileBackedNode,
		targetFile: resolveActiveCanvasFileTarget(canvasApp, fileBackedNode),
	};
}

export async function resolveConfiguredCanvasCaptureTarget(
	app: App,
	canvasPath: string,
	nodeId: string,
	action: CaptureAction,
): Promise<ConfiguredCanvasCaptureTarget> {
	const trimmedNodeId = nodeId.trim();
	if (!trimmedNodeId) {
		throw new ChoiceAbortError("Canvas node id is required for Canvas node capture.");
	}

	const abstractCanvasFile = app.vault.getAbstractFileByPath(canvasPath);
	if (!isTFileLike(abstractCanvasFile)) {
		throw new ChoiceAbortError(`Canvas target not found: ${canvasPath}`);
	}

	if (!CANVAS_FILE_EXTENSION_REGEX.test(abstractCanvasFile.path)) {
		throw new ChoiceAbortError(
			"Canvas node capture requires the target path to be a .canvas file.",
		);
	}

	const rawCanvas = await app.vault.read(abstractCanvasFile);
	const canvasData = parseStoredCanvasData(rawCanvas, abstractCanvasFile.path);
	const nodeIndex = canvasData.nodes.findIndex((node) => node.id === trimmedNodeId);
	if (nodeIndex === -1) {
		throw new ChoiceAbortError(
			`Canvas node id '${trimmedNodeId}' was not found in ${abstractCanvasFile.path}.`,
		);
	}

	const nodeData = canvasData.nodes[nodeIndex];
	const nodeKind = getNodeKind(nodeData);
	if (nodeKind === "unsupported") {
		throw new ChoiceAbortError(
			"Canvas capture currently supports only text and file cards.",
		);
	}

	const unsupportedReason = getCanvasActionUnsupportedReason(nodeKind, action);
	if (unsupportedReason) {
		throw new ChoiceAbortError(unsupportedReason);
	}

	if (nodeKind === "text") {
		return {
			kind: "text",
			source: "configured",
			canvasFile: abstractCanvasFile,
			rawCanvas,
			canvasData,
			nodeData,
			nodeIndex,
		};
	}

	const canvasApp = app as unknown as CanvasAppLike;
	const { targetPath, targetFile } = resolveConfiguredCanvasFileTarget(
		canvasApp,
		nodeData,
	);
	return {
		kind: "file",
		source: "configured",
		canvasFile: abstractCanvasFile,
		nodeData,
		targetPath,
		targetFile,
	};
}

export function getCanvasTextCaptureContent(
	target: CanvasTextCaptureTarget,
): string {
	if (target.source === "active") {
		if (typeof target.node.text === "string") {
			return target.node.text;
		}

		if (typeof target.nodeData?.text === "string") {
			return target.nodeData.text;
		}

		return "";
	}

	if (typeof target.nodeData.text === "string") {
		return target.nodeData.text;
	}

	return "";
}

export async function setCanvasTextCaptureContent(
	app: App,
	target: CanvasTextCaptureTarget,
	nextText: string,
): Promise<void> {
	if (target.source === "active") {
		if (typeof target.node.setText === "function") {
			target.node.setText(nextText);
		} else {
			target.node.text = nextText;
		}

		target.canvas.requestSave?.();
		return;
	}

	const latestRawCanvas = await app.vault.read(target.canvasFile);
	if (latestRawCanvas !== target.rawCanvas) {
		throw new ChoiceAbortError(
			"Canvas target changed while capture was running. Re-run capture to avoid overwriting newer Canvas edits.",
		);
	}

	target.nodeData.text = nextText;
	target.canvasData.nodes[target.nodeIndex] = target.nodeData;
	await app.vault.modify(
		target.canvasFile,
		JSON.stringify(target.canvasData, null, 2),
	);
}

export function mergeCanvasTextAtTop(
	existingText: string,
	captureContent: string,
): string {
	if (!existingText) return captureContent;
	if (!captureContent) return existingText;

	const needsSeparator =
		!captureContent.endsWith("\n") && !existingText.startsWith("\n");
	return `${captureContent}${needsSeparator ? "\n" : ""}${existingText}`;
}

export function mergeCanvasTextAtBottom(
	existingText: string,
	captureContent: string,
): string {
	if (!existingText) return captureContent;
	if (!captureContent) return existingText;

	const needsSeparator =
		!existingText.endsWith("\n") && !captureContent.startsWith("\n");
	return `${existingText}${needsSeparator ? "\n" : ""}${captureContent}`;
}

