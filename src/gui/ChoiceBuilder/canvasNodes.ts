import type { App } from "obsidian";
import { TFile } from "obsidian";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "../../constants";

/**
 * Pure (App-seam) canvas-target helpers extracted verbatim from
 * captureChoiceBuilder so the Svelte CanvasNodePicker and the form's onChange
 * handlers share the exact same predicates (issue #1130 conversion).
 */

export interface CanvasNodeOption {
	id: string;
	type: "text" | "file" | "other";
	title: string;
	subtitle: string;
	searchText: string;
	capturable: boolean;
	capturableReason: string;
}

export function normalizeVaultPath(path: string): string {
	return path.trim().replace(/^\/+/, "");
}

export function isCanvasTargetPath(path: string): boolean {
	return path.trim().toLowerCase().endsWith(".canvas");
}

export function resolveStaticCanvasTargetFile(
	app: App,
	path: string,
): TFile | null {
	const trimmedPath = normalizeVaultPath(path);
	if (!trimmedPath || trimmedPath.includes("{{")) {
		return null;
	}

	const abstractFile = app.vault.getAbstractFileByPath(trimmedPath);
	if (!abstractFile) {
		return null;
	}

	if (!(abstractFile instanceof TFile) || abstractFile.extension !== "canvas") {
		return null;
	}

	return abstractFile;
}

export function getActiveCanvasSelectionNodeIdForPath(
	app: App,
	canvasPath: string,
): string | null {
	const mostRecentLeaf = app.workspace.getMostRecentLeaf?.() as
		| {
				view?: {
					getViewType?: () => string;
					file?: { path?: string };
					canvas?: {
						selection?: Set<{ id?: string }>;
					};
				};
		  }
		| null
		| undefined;
	const view = mostRecentLeaf?.view;
	if (!view || view.getViewType?.() !== "canvas") {
		return null;
	}

	const targetPath = normalizeVaultPath(canvasPath);
	const activeCanvasPath = normalizeVaultPath(
		view.file?.path ?? app.workspace.getActiveFile()?.path ?? "",
	);
	if (!targetPath || targetPath !== activeCanvasPath) {
		return null;
	}

	const selectedNodes = view.canvas?.selection
		? Array.from(view.canvas.selection)
		: [];
	if (selectedNodes.length !== 1) {
		return null;
	}

	const nodeId = selectedNodes[0]?.id;
	return typeof nodeId === "string" && nodeId.length > 0 ? nodeId : null;
}

function getCanvasNodeFilePath(fileField: unknown): string {
	if (typeof fileField === "string") {
		return fileField;
	}

	if (
		fileField &&
		typeof fileField === "object" &&
		"path" in fileField &&
		typeof (fileField as { path?: unknown }).path === "string"
	) {
		return (fileField as { path: string }).path;
	}

	return "(missing file path)";
}

function describeCanvasNodeCoordinates(node: {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}): string {
	if (
		typeof node.x !== "number" ||
		typeof node.y !== "number" ||
		typeof node.width !== "number" ||
		typeof node.height !== "number"
	) {
		return "";
	}

	return `${Math.round(node.x)},${Math.round(node.y)} · ${Math.round(node.width)}x${Math.round(node.height)}`;
}

function truncatePickerText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}

	return value.slice(0, maxLength - 1) + "…";
}

export async function readCanvasNodeOptions(
	app: App,
	canvasFile: TFile,
): Promise<CanvasNodeOption[]> {
	try {
		const raw = await app.vault.cachedRead(canvasFile);
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") {
			return [];
		}

		const nodes = (parsed as { nodes?: unknown }).nodes;
		if (!Array.isArray(nodes)) {
			return [];
		}

		const options = nodes
			.filter(
				(
					node,
				): node is {
					id: string;
					type?: string;
					text?: unknown;
					file?: unknown;
					x?: number;
					y?: number;
					width?: number;
					height?: number;
				} =>
					!!node &&
					typeof node === "object" &&
					typeof (node as { id?: unknown }).id === "string",
			)
			.map((node): CanvasNodeOption => {
				const nodeType: "text" | "file" | "other" =
					node.type === "text"
						? "text"
						: node.type === "file"
							? "file"
							: "other";

				const coords = describeCanvasNodeCoordinates(node);
				if (nodeType === "text") {
					const rawText = typeof node.text === "string" ? node.text : "";
					const lines = rawText
						.split("\n")
						.map((line) => line.trim())
						.filter((line) => line.length > 0);
					const title = truncatePickerText(
						lines[0] ?? "(empty text card)",
						90,
					);
					const subtitleParts = [
						`${lines.length} line${lines.length === 1 ? "" : "s"}`,
					];
					if (coords) {
						subtitleParts.push(coords);
					}
					const subtitle = subtitleParts.join(" · ");
					return {
						id: node.id,
						type: nodeType,
						title,
						subtitle,
						searchText: `${node.id} ${title} ${subtitle}`.toLowerCase(),
						capturable: true,
						capturableReason: "",
					};
				}

				if (nodeType === "file") {
					const filePath = getCanvasNodeFilePath(node.file);
					const isMarkdownFile = MARKDOWN_FILE_EXTENSION_REGEX.test(filePath);
					const capturableReason = isMarkdownFile
						? ""
						: "Canvas file cards must link to markdown files (.md).";
					const title = truncatePickerText(
						filePath.split("/").pop() ?? filePath,
						90,
					);
					const subtitleParts = [truncatePickerText(filePath, 120)];
					if (coords) {
						subtitleParts.push(coords);
					}
					if (!isMarkdownFile) {
						subtitleParts.push("Not capturable in this version");
					}
					const subtitle = subtitleParts.join(" · ");
					return {
						id: node.id,
						type: nodeType,
						title,
						subtitle,
						searchText: `${node.id} ${title} ${subtitle}`.toLowerCase(),
						capturable: isMarkdownFile,
						capturableReason,
					};
				}

				const nodeTypeLabel =
					typeof node.type === "string" && node.type.length > 0
						? node.type
						: "unknown";
				const title = `Unsupported node (${nodeTypeLabel})`;
				const subtitle = coords || "Type is not currently capturable";
				return {
					id: node.id,
					type: nodeType,
					title,
					subtitle,
					searchText: `${node.id} ${title} ${subtitle}`.toLowerCase(),
					capturable: false,
					capturableReason: "This Canvas node type is not capturable.",
				};
			});

		const typeOrder: Record<"text" | "file" | "other", number> = {
			text: 0,
			file: 1,
			other: 2,
		};

		return options.sort((a, b) => {
			const typeDiff = typeOrder[a.type] - typeOrder[b.type];
			if (typeDiff !== 0) {
				return typeDiff;
			}

			return a.title.localeCompare(b.title);
		});
	} catch {
		return [];
	}
}
