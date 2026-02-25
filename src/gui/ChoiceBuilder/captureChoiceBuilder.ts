import type { App, TFile } from "obsidian";
import { Notice, Setting, TextComponent, ToggleComponent } from "obsidian";
import {
	CREATE_IF_NOT_FOUND_BOTTOM,
	CREATE_IF_NOT_FOUND_CURSOR,
	CREATE_IF_NOT_FOUND_TOP,
	FILE_NAME_FORMAT_SYNTAX,
} from "../../constants";
import { FileNameDisplayFormatter } from "../../formatters/fileNameDisplayFormatter";
import { FormatDisplayFormatter } from "../../formatters/formatDisplayFormatter";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type { LinkPlacement, LinkType } from "../../types/linkPlacement";
import {
	normalizeAppendLinkOptions,
	placementSupportsEmbed,
} from "../../types/linkPlacement";
import { getAllFolderPathsInVault } from "../../utilityObsidian";
import { createValidatedInput } from "../components/validatedInput";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import { ChoiceBuilder } from "./choiceBuilder";

export class CaptureChoiceBuilder extends ChoiceBuilder {
	choice: ICaptureChoice;

	constructor(
		app: App,
		choice: ICaptureChoice,
		private plugin: QuickAdd,
	) {
		super(app);
		this.choice = choice;

		this.display();
	}

	protected display() {
		this.containerEl.addClass("captureChoiceBuilder");
		this.contentEl.empty();

		this.addCenteredChoiceNameHeader(this.choice);

		// Location
		new Setting(this.contentEl).setName("Location").setHeading();
		this.addCapturedToSetting();
		if (!this.choice?.captureToActiveFile) {
			this.addCreateIfNotExistsSetting();
			if (this.choice?.createFileIfItDoesntExist?.enabled)
				this.addCreateWithTemplateSetting();
		}

		// Position
		new Setting(this.contentEl).setName("Position").setHeading();
		this.addWritePositionSetting();

		// Linking
		new Setting(this.contentEl).setName("Linking").setHeading();
		this.addAppendLinkSetting();

		// Content
		new Setting(this.contentEl).setName("Content").setHeading();
		this.addTaskSetting();
		this.addFormatSetting();

		// Behavior
		new Setting(this.contentEl).setName("Behavior").setHeading();
		if (!this.choice.captureToActiveFile) {
			this.addOpenFileSetting("Open the captured file.");

			if (this.choice.openFile) {
				this.addFileOpeningSetting("captured");
			}
		}
		this.addSelectionAsValueSetting();
		this.addTemplaterAfterCaptureSetting();
		this.addOnePageOverrideSetting(this.choice);
	}

	private addTemplaterAfterCaptureSetting() {
		new Setting(this.contentEl)
			.setName("Run Templater on entire destination file after capture")
			.setDesc(
				"Advanced / legacy: this executes any `<% %>` anywhere in the destination file (including inside code blocks).",
			)
			.addToggle((toggle) => {
				toggle.setValue(this.choice.templater?.afterCapture === "wholeFile");
				toggle.onChange((value) => {
					if (!this.choice.templater) {
						this.choice.templater = {};
					}
					this.choice.templater.afterCapture = value ? "wholeFile" : "none";
				});
			});
	}

	private addSelectionAsValueSetting() {
		new Setting(this.contentEl)
			.setName("Use editor selection as default value")
			.setDesc(
				"Controls whether this Capture uses the current editor selection as {{VALUE}}. Does not affect {{SELECTED}}.",
			)
			.addDropdown((dropdown) => {
				dropdown.addOptions({
					"": "Follow global setting",
					enabled: "Use selection",
					disabled: "Ignore selection",
				});
				const override = this.choice.useSelectionAsCaptureValue;
				dropdown.setValue(
					typeof override === "boolean"
						? override
							? "enabled"
							: "disabled"
						: "",
				);
				dropdown.onChange((value) => {
					if (value === "") {
						this.choice.useSelectionAsCaptureValue = undefined;
						return;
					}
					this.choice.useSelectionAsCaptureValue = value === "enabled";
				});
			});
	}

	private addCapturedToSetting() {
		new Setting(this.contentEl)
			.setName("Capture to")
			.setDesc(
				"Vault-relative path. Supports format syntax (use trailing '/' for folders).",
			);

		const captureToContainer: HTMLDivElement =
			this.contentEl.createDiv("captureToContainer");

		const captureToActiveFileContainer: HTMLDivElement =
			captureToContainer.createDiv("captureToActiveFileContainer");
		const captureToActiveFileText: HTMLSpanElement =
			captureToActiveFileContainer.createEl("span");
		captureToActiveFileText.textContent = "Capture to active file";
		const captureToActiveFileToggle: ToggleComponent = new ToggleComponent(
			captureToActiveFileContainer,
		);
		captureToActiveFileToggle.setValue(this.choice?.captureToActiveFile);
		captureToActiveFileToggle.onChange((value) => {
			this.choice.captureToActiveFile = value;

			// Reset new line capture settings when switching away from active file
			// since those options are only available for active file capture
			if (!value && this.choice.newLineCapture?.enabled) {
				this.choice.newLineCapture.enabled = false;
			}

			this.reload();
		});

		if (!this.choice?.captureToActiveFile) {
			if (!this.isCanvasTargetPath(this.choice.captureTo)) {
				this.choice.captureToCanvasNodeId = "";
			}

			const captureToFileContainer: HTMLDivElement =
				captureToContainer.createDiv("captureToFileContainer");

			new Setting(captureToFileContainer)
				.setName("File path / format")
				.setDesc("Choose a file, folder, or format syntax (e.g., {{DATE}})");

			const displayFormatter: FileNameDisplayFormatter =
				new FileNameDisplayFormatter(this.app, this.plugin);

			const previewRow = captureToFileContainer.createDiv({ cls: "qa-preview-row" });
			previewRow.createEl("span", { text: "Preview: ", cls: "qa-preview-label" });
			const formatDisplay = previewRow.createEl("span");
			formatDisplay.setAttr("aria-live", "polite");
			formatDisplay.textContent = "Loading preview…";

			const folderPaths = getAllFolderPathsInVault(this.app)
				.filter((folderPath) => folderPath.length > 0)
				.map((folderPath) =>
					folderPath.endsWith("/") ? folderPath : folderPath + "/",
				);
			const markdownPaths = this.app.vault
				.getMarkdownFiles()
				.map((file) => file.path);
			const canvasPaths = this.app.vault
				.getFiles()
				.filter((file) => file.extension === "canvas")
				.map((file) => file.path);

			const captureTargetSuggestions = Array.from(
				new Set([
					...folderPaths,
					...markdownPaths,
					...canvasPaths,
					...FILE_NAME_FORMAT_SYNTAX,
				]),
			);

			createValidatedInput({
				app: this.app,
				parent: captureToFileContainer,
				initialValue: this.choice.captureTo,
				placeholder: "File name format",
				suggestions: captureTargetSuggestions,
				maxSuggestions: 50,
				attachSuggesters: [
					(el) => new FormatSyntaxSuggester(this.app, el, this.plugin),
				],
				onChange: async (value) => {
					const wasCanvasTarget = this.isCanvasTargetPath(this.choice.captureTo);
					this.choice.captureTo = value;
					const isCanvasTarget = this.isCanvasTargetPath(value);

					if (!isCanvasTarget) {
						this.choice.captureToCanvasNodeId = "";
					}

					try {
						formatDisplay.textContent = await displayFormatter.format(value);
					} catch {
						formatDisplay.textContent = "Preview unavailable";
					}

					if (wasCanvasTarget !== isCanvasTarget) {
						this.reload();
					}
				},
			});

			void (async () => {
				try {
					formatDisplay.textContent = await displayFormatter.format(
						this.choice.captureTo,
					);
				} catch {
					formatDisplay.textContent = "Preview unavailable";
				}
			})();

			if (this.isCanvasTargetPath(this.choice.captureTo)) {
				let nodeIdInputRef: TextComponent | null = null;

				new Setting(captureToFileContainer)
					.setName("Target canvas node")
					.setDesc(
						"Choose a card from the canvas below, or paste an exact node id.",
					)
					.addText((textInput) => {
						nodeIdInputRef = textInput;
						textInput.setPlaceholder("Canvas node id");
						textInput.setValue(this.choice.captureToCanvasNodeId ?? "");
						textInput.onChange((value) => {
							this.choice.captureToCanvasNodeId = value.trim();
						});
					});

				captureToFileContainer.createDiv({
					cls: "qa-canvas-node-helper",
					text: "Tip: open this canvas and select one card to grab its id instantly.",
				});

				this.renderCanvasNodePicker(
					captureToFileContainer,
					this.choice.captureTo,
					nodeIdInputRef,
				);
			}
		}
	}

	private renderCanvasNodePicker(
		container: HTMLDivElement,
		canvasTargetPath: string,
		nodeIdInputRef: TextComponent | null,
	): void {
		const picker = container.createDiv({ cls: "qa-canvas-node-picker" });
		const actions = picker.createDiv({ cls: "qa-canvas-node-actions" });
		const openCanvasButton = actions.createEl("button", {
			text: "Open target canvas",
		});
		const useActiveSelectionButton = actions.createEl("button", {
			text: "Use selected in open canvas",
		});
		const clearButton = actions.createEl("button", {
			text: "Clear",
		});

		const filterContainer = picker.createDiv({ cls: "qa-canvas-node-filter" });
		const filterInput = new TextComponent(filterContainer);
		filterInput.setPlaceholder(
			"Filter by card text, file path, or node id…",
		);

		const status = picker.createDiv({
			cls: "qa-canvas-node-status",
			text: "Loading canvas nodes…",
		});
		const list = picker.createDiv({ cls: "qa-canvas-node-list" });

		const applyNodeId = (nodeId: string) => {
			this.choice.captureToCanvasNodeId = nodeId;
			nodeIdInputRef?.setValue(nodeId);
		};

		openCanvasButton.addEventListener("click", () => {
			const canvasFile = this.resolveStaticCanvasTargetFile(canvasTargetPath);
			if (!canvasFile) {
				new Notice("Target canvas file was not found.");
				return;
			}

			void this.app.workspace
				.getLeaf(true)
				.openFile(canvasFile)
				.catch(() => new Notice("Could not open target canvas."));
		});

		clearButton.addEventListener("click", () => {
			applyNodeId("");
		});

		useActiveSelectionButton.addEventListener("click", () => {
			const activeSelectionNodeId = this.getActiveCanvasSelectionNodeIdForPath(
				canvasTargetPath,
			);
			if (!activeSelectionNodeId) {
				new Notice(
					"Open the target canvas and select exactly one card to use this action.",
				);
				return;
			}

			applyNodeId(activeSelectionNodeId);
			renderList(filterInput.getValue());
		});

		const renderEmpty = (message: string) => {
			status.setText(message);
			list.empty();
			list.createDiv({
				cls: "qa-canvas-node-empty",
				text: message,
			});
		};

		let nodeOptions: Array<{
			id: string;
			type: "text" | "file" | "other";
			title: string;
			subtitle: string;
			searchText: string;
		}> = [];

		const renderList = (query: string) => {
			const normalizedQuery = query.trim().toLowerCase();
			const filteredOptions = normalizedQuery.length
				? nodeOptions.filter((option) => option.searchText.includes(normalizedQuery))
				: nodeOptions;

			status.setText(
				`Showing ${filteredOptions.length} of ${nodeOptions.length} nodes`,
			);
			list.empty();

			if (filteredOptions.length === 0) {
				list.createDiv({
					cls: "qa-canvas-node-empty",
					text: "No nodes match the current filter.",
				});
				return;
			}

			const selectedNodeId = (this.choice.captureToCanvasNodeId ?? "").trim();

			for (const option of filteredOptions) {
				const item = list.createDiv({ cls: "qa-canvas-node-item" });
				const isSelected = selectedNodeId === option.id;
				if (isSelected) {
					item.addClass("is-selected");
				}

				const header = item.createDiv({ cls: "qa-canvas-node-item-header" });
				const typeBadge = header.createEl("span", {
					cls: "qa-canvas-node-type",
					text:
						option.type === "text"
							? "TEXT"
							: option.type === "file"
								? "FILE"
								: "NODE",
				});
				typeBadge.addClass(`is-${option.type}`);
				header.createEl("span", {
					cls: "qa-canvas-node-title",
					text: option.title,
				});

				item.createDiv({
					cls: "qa-canvas-node-subtitle",
					text: option.subtitle,
				});

				const meta = item.createDiv({ cls: "qa-canvas-node-meta" });
				meta.createEl("code", { text: option.id });

				const itemActions = item.createDiv({
					cls: "qa-canvas-node-item-actions",
				});
				const useButton = itemActions.createEl("button", {
					text: isSelected ? "Selected" : "Use node",
				});
				if (isSelected) {
					useButton.addClass("mod-cta");
				}
				useButton.addEventListener("click", () => {
					applyNodeId(option.id);
					renderList(filterInput.getValue());
				});

				const copyButton = itemActions.createEl("button", {
					text: "Copy ID",
				});
				copyButton.addEventListener("click", async () => {
					try {
						await navigator.clipboard.writeText(option.id);
						new Notice(`Copied node id ${option.id}`);
					} catch {
						new Notice("Could not copy node id automatically.");
					}
				});
			}
		};

		filterInput.onChange((value) => {
			renderList(value);
		});

		void (async () => {
			const canvasFile = this.resolveStaticCanvasTargetFile(canvasTargetPath);
			if (!canvasFile) {
				renderEmpty(
					"Node picker works for direct .canvas paths that already exist in your vault. Format syntax paths cannot be listed here.",
				);
				return;
			}

			nodeOptions = await this.readCanvasNodeOptions(canvasFile);
			if (nodeOptions.length === 0) {
				renderEmpty("No selectable nodes found in the target canvas.");
				return;
			}

			renderList("");
		})();
	}

	private getActiveCanvasSelectionNodeIdForPath(
		canvasPath: string,
	): string | null {
		const activeLeaf = this.app.workspace.activeLeaf as
			{
				view?: {
					getViewType?: () => string;
					file?: { path?: string };
					canvas?: {
						selection?: Set<{ id?: string }>;
					};
				};
			} | undefined;
		const view = activeLeaf?.view;
		if (!view || view.getViewType?.() !== "canvas") {
			return null;
		}

		const targetPath = this.normalizeVaultPath(canvasPath);
		const activeCanvasPath = this.normalizeVaultPath(
			view.file?.path ?? this.app.workspace.getActiveFile()?.path ?? "",
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

	private normalizeVaultPath(path: string): string {
		return path.trim().replace(/^\/+/, "");
	}

	private isCanvasTargetPath(path: string): boolean {
		return path.trim().toLowerCase().endsWith(".canvas");
	}

	private resolveStaticCanvasTargetFile(path: string): TFile | null {
		const trimmedPath = this.normalizeVaultPath(path);
		if (!trimmedPath || trimmedPath.includes("{{")) {
			return null;
		}

		const abstractFile = this.app.vault.getAbstractFileByPath(trimmedPath);
		if (!abstractFile) {
			return null;
		}

		if (!("extension" in abstractFile) || abstractFile.extension !== "canvas") {
			return null;
		}

		return abstractFile as TFile;
	}

	private async readCanvasNodeOptions(
		canvasFile: TFile,
	): Promise<Array<{
		id: string;
		type: "text" | "file" | "other";
		title: string;
		subtitle: string;
		searchText: string;
	}>> {
		try {
			const raw = await this.app.vault.cachedRead(canvasFile);
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
					(node): node is {
						id: string;
						type?: string;
						text?: string;
						file?: string | { path?: string };
						x?: number;
						y?: number;
						width?: number;
						height?: number;
					} =>
						!!node &&
						typeof node === "object" &&
						typeof (node as { id?: unknown }).id === "string",
				)
				.map((node) => {
					const nodeType: "text" | "file" | "other" =
						node.type === "text"
							? "text"
							: node.type === "file"
								? "file"
								: "other";

					const coords = this.describeCanvasNodeCoordinates(node);
					if (nodeType === "text") {
						const lines = (node.text ?? "")
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line.length > 0);
						const title =
							this.truncatePickerText(lines[0] ?? "(empty text card)", 90);
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
						};
					}

					if (nodeType === "file") {
						const filePath =
							typeof node.file === "string"
								? node.file
								: node.file?.path ?? "(missing file path)";
						const title = this.truncatePickerText(
							filePath.split("/").pop() ?? filePath,
							90,
						);
						const subtitleParts = [this.truncatePickerText(filePath, 120)];
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
						};
					}

					const title = `Unsupported node (${node.type ?? "unknown"})`;
					const subtitle = coords || "Type is not currently capturable";
					return {
						id: node.id,
						type: nodeType,
						title,
						subtitle,
						searchText: `${node.id} ${title} ${subtitle}`.toLowerCase(),
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

	private describeCanvasNodeCoordinates(node: {
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

	private truncatePickerText(value: string, maxLength: number): string {
		if (value.length <= maxLength) {
			return value;
		}

		return value.slice(0, maxLength - 1) + "…";
	}

	private addTaskSetting() {
		const taskSetting: Setting = new Setting(this.contentEl);
		taskSetting
			.setName("Task")
			.setDesc("Formats the value as a task.")
			.addToggle((toggle) => {
				toggle.setValue(this.choice.task);
				toggle.onChange((value) => (this.choice.task = value));
			});
	}

	private addAppendLinkSetting() {
		// Normalize to ensure we're always working with the new format internally
		const normalizedOptions = normalizeAppendLinkOptions(
			this.choice.appendLink,
		);
		const normalizedLinkType = normalizedOptions.linkType ?? "link";

		type AppendLinkMode = "required" | "optional" | "disabled";
		const currentMode: AppendLinkMode = normalizedOptions.enabled
			? normalizedOptions.requireActiveFile
				? "required"
				: "optional"
			: "disabled";

		const appendLinkSetting: Setting = new Setting(this.contentEl);
		appendLinkSetting
			.setName("Link to captured file")
			.setDesc("Choose how QuickAdd should insert a link to the captured file in the current note.")
			.addDropdown((dropdown) => {
				dropdown.addOption("required", "Enabled (requires active file)");
				dropdown.addOption("optional", "Enabled (skip if no active file)");
				dropdown.addOption("disabled", "Disabled");

				dropdown.setValue(currentMode);
				dropdown.onChange((value: AppendLinkMode) => {
					switch (value) {
						case "disabled":
							this.choice.appendLink = false;
							break;
						case "required":
							this.choice.appendLink = {
								enabled: true,
								placement: normalizedOptions.placement,
								requireActiveFile: true,
								linkType: normalizedLinkType,
							};
							break;
						case "optional":
							this.choice.appendLink = {
								enabled: true,
								placement: normalizedOptions.placement,
								requireActiveFile: false,
								linkType: normalizedLinkType,
							};
							break;
					}
					this.reload();
				});
			});

		// Only show placement dropdown when append link is enabled
		if (currentMode !== "disabled") {
			const placementSetting: Setting = new Setting(this.contentEl);
			placementSetting
				.setName("Link placement")
				.setDesc("Where to place the link when appending")
				.addDropdown((dropdown) => {
					dropdown.addOption("replaceSelection", "Replace selection");
					dropdown.addOption("afterSelection", "After selection");
					dropdown.addOption("endOfLine", "End of line");
					dropdown.addOption("newLine", "New line");

					dropdown.setValue(normalizedOptions.placement);
					dropdown.onChange((value: LinkPlacement) => {
						const currentValue = this.choice.appendLink;
						const requireActiveFile =
							typeof currentValue === "boolean"
								? normalizedOptions.requireActiveFile
								: currentValue.requireActiveFile;
						const previousLinkType =
							typeof currentValue === "boolean"
								? normalizedLinkType
								: currentValue.linkType ?? normalizedLinkType;
				const nextLinkType = placementSupportsEmbed(value)
					? previousLinkType
					: "link";

						this.choice.appendLink = {
							enabled: true,
							placement: value,
							requireActiveFile,
							linkType: nextLinkType,
						};

						this.reload();
					});
				});

			if (placementSupportsEmbed(normalizedOptions.placement)) {
				const linkTypeSetting: Setting = new Setting(this.contentEl);
				linkTypeSetting
					.setName("Link type")
					.setDesc("Choose whether to insert a regular link or an embed when replacing the selection.")
					.addDropdown((dropdown) => {
						dropdown.addOption("link", "Link");
						dropdown.addOption("embed", "Embed");
						dropdown.setValue(normalizedLinkType);
						dropdown.onChange((value: LinkType) => {
							const currentValue = this.choice.appendLink;
							const requireActiveFile =
								typeof currentValue === "boolean"
									? normalizedOptions.requireActiveFile
									: currentValue.requireActiveFile;
							const placement =
								typeof currentValue === "boolean"
									? normalizedOptions.placement
									: currentValue.placement;

							this.choice.appendLink = {
								enabled: true,
								placement,
								requireActiveFile,
								linkType: value,
							};
						});
					});
			}
		}
	}

	private addWritePositionSetting() {
		const positionSetting: Setting = new Setting(this.contentEl);
		const isActiveFile = !!this.choice?.captureToActiveFile;

		if (!this.choice.activeFileWritePosition) {
			this.choice.activeFileWritePosition = "cursor";
		}

		positionSetting
			.setName("Write position")
			.setDesc(
				isActiveFile
					? "Where to place the capture in the current file."
					: "Where to place the capture in the target file.",
			)
			.addDropdown((dropdown) => {
				const current = this.choice.insertAfter?.enabled
					? "after"
					: this.choice.newLineCapture?.enabled
						? this.choice.newLineCapture.direction === "above"
							? "newLineAbove"
							: "newLineBelow"
						: isActiveFile
							? this.choice.activeFileWritePosition === "top"
								? "activeTop"
								: this.choice.activeFileWritePosition === "bottom" ||
									this.choice.prepend
									? "bottom"
									: "top"
							: this.choice.prepend
								? "bottom"
								: "top";

				dropdown.addOption("top", isActiveFile ? "At cursor" : "Top of file");

				if (isActiveFile) {
					dropdown.addOption("activeTop", "Top of file (after frontmatter)");
					dropdown.addOption("newLineAbove", "New line above cursor");
					dropdown.addOption("newLineBelow", "New line below cursor");
				}
				
				dropdown.addOption("after", "After line…");
				dropdown.addOption("bottom", "Bottom of file");
				dropdown.setValue(current);
				dropdown.onChange((value: string) => {
					const v = value as
						| "top"
						| "after"
						| "bottom"
						| "newLineAbove"
						| "newLineBelow"
						| "activeTop";
					
					this.choice.prepend = false;
					this.choice.insertAfter.enabled = false;
					if (!this.choice.newLineCapture) {
						this.choice.newLineCapture = { enabled: false, direction: "below" };
					}
					this.choice.newLineCapture.enabled = false;
					this.choice.activeFileWritePosition = "cursor";
					
					if (v === "top") {
						if (!isActiveFile) {
							this.choice.prepend = false;
						}
						this.reload();
						return;
					}

					if (v === "activeTop") {
						if (isActiveFile) {
							this.choice.activeFileWritePosition = "top";
						}
						this.reload();
						return;
					}

					if (v === "bottom") {
						if (isActiveFile) {
							this.choice.activeFileWritePosition = "bottom";
						} else {
							this.choice.prepend = true;
						}
						this.reload();
						return;
					}
					
					if (v === "newLineAbove") {
						this.choice.newLineCapture.enabled = true;
						this.choice.newLineCapture.direction = "above";
						this.reload();
						return;
					}
					
					if (v === "newLineBelow") {
						this.choice.newLineCapture.enabled = true;
						this.choice.newLineCapture.direction = "below";
						this.reload();
						return;
					}

					// after line
					this.choice.insertAfter.enabled = true;
					this.reload();
				});
			});

		if (this.choice.insertAfter.enabled) {
			this.addInsertAfterFields();
		}

		this.addCanvasModeCompatibilityNotice(isActiveFile);
	}

	private addCanvasModeCompatibilityNotice(isActiveFile: boolean) {
		const obviousCanvasTarget =
			typeof this.choice.captureTo === "string" &&
			this.choice.captureTo.trim().toLowerCase().endsWith(".canvas");
		const usesCursorMode =
			isActiveFile &&
			!this.choice.insertAfter.enabled &&
			!this.choice.newLineCapture?.enabled &&
			(this.choice.activeFileWritePosition ?? "cursor") === "cursor" &&
			!this.choice.prepend;
		const usesUnsupportedCanvasMode =
			this.choice.newLineCapture?.enabled || usesCursorMode;

		if (!usesUnsupportedCanvasMode) return;
		if (!isActiveFile && !obviousCanvasTarget) return;

		const warning = this.contentEl.createDiv({ cls: "setting-item-description" });
		warning.setText(
			"Canvas note: 'At cursor' and 'New line above/below cursor' are not supported for Canvas card capture. Use top, bottom, or insert-after placement.",
		);
	}

	private addInsertAfterFields() {
		const descText =
			"Insert capture after specified text. Accepts format syntax. " +
			"Tip: use a heading (starts with #) to target a section. " +
			"Blank line handling is configurable below.";

		new Setting(this.contentEl)
			.setName("Insert after")
			.setDesc(descText);

		const displayFormatter: FormatDisplayFormatter = new FormatDisplayFormatter(
			this.app,
			this.plugin,
		);

		const previewRow = this.contentEl.createDiv({ cls: "qa-preview-row" });
		previewRow.createEl("span", { text: "Preview: ", cls: "qa-preview-label" });
		const previewValue = previewRow.createEl("span");
		previewValue.setAttribute("aria-live", "polite");
		previewValue.innerText = "Loading preview…";

		createValidatedInput({
			app: this.app,
			parent: this.contentEl,
			initialValue: this.choice.insertAfter.after,
			placeholder: "Insert after",
			required: true,
			requiredMessage: "Insert after text is required",
			attachSuggesters: [
				(el) => new FormatSyntaxSuggester(this.app, el, this.plugin),
			],
			onChange: async (value) => {
				this.choice.insertAfter.after = value;
				try {
					previewValue.innerText = await displayFormatter.format(value);
				} catch {
					previewValue.innerText = "Preview unavailable";
				}
			},
		});

		void (async () => {
			try {
				previewValue.innerText = await displayFormatter.format(
					this.choice.insertAfter.after,
				);
			} catch {
				previewValue.innerText = "Preview unavailable";
			}
		})();

		if (this.choice.insertAfter.inline === undefined) {
			this.choice.insertAfter.inline = false;
		}

		if (this.choice.insertAfter.replaceExisting === undefined) {
			this.choice.insertAfter.replaceExisting = false;
		}

		new Setting(this.contentEl)
			.setName("Inline insertion")
			.setDesc(
				"Insert captured content on the same line, immediately after the matched text (no newline added).",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(!!this.choice.insertAfter?.inline)
					.onChange((value) => {
						this.choice.insertAfter.inline = value;
						this.reload();
					}),
			);

		if (this.choice.insertAfter.inline) {
			new Setting(this.contentEl)
				.setName("Replace existing value")
				.setDesc("Replace everything after the matched text up to end-of-line.")
				.addToggle((toggle) =>
					toggle
						.setValue(!!this.choice.insertAfter?.replaceExisting)
						.onChange(
							(value) => (this.choice.insertAfter.replaceExisting = value),
						),
				);
		}

		const inlineEnabled = !!this.choice.insertAfter?.inline;

		if (!inlineEnabled) {
			const insertAtEndSetting: Setting = new Setting(this.contentEl);
			insertAtEndSetting
				.setName("Insert at end of section")
				.setDesc(
					"Place the text at the end of the matched section instead of the top.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.choice.insertAfter?.insertAtEnd)
						.onChange((value) => {
							this.choice.insertAfter.insertAtEnd = value;
							this.reload();
						}),
				);

			if (!this.choice.insertAfter?.blankLineAfterMatchMode) {
				this.choice.insertAfter.blankLineAfterMatchMode = "auto";
			}

			const blankLineModeDesc =
				"Controls whether Insert After skips existing blank lines after the matched line.";
			const insertAtEndEnabled = !!this.choice.insertAfter?.insertAtEnd;
			const blankLineModeSetting: Setting = new Setting(this.contentEl);
			blankLineModeSetting
				.setName("Blank lines after match")
				.setDesc(
					insertAtEndEnabled
						? "Not used when inserting at end of section."
						: blankLineModeDesc,
				)
					.addDropdown((dropdown) => {
						dropdown
							.addOption("auto", "Auto (headings only)")
							.addOption("skip", "Always skip")
							.addOption("none", "Never skip")
							.setValue(
								this.choice.insertAfter?.blankLineAfterMatchMode ?? "auto",
							)
							.onChange((value) => {
								this.choice.insertAfter.blankLineAfterMatchMode = value as
									| "auto"
									| "skip"
									| "none";
						});
					dropdown.setDisabled(insertAtEndEnabled);
				});
			blankLineModeSetting.setDisabled(insertAtEndEnabled);

			new Setting(this.contentEl)
				.setName("Consider subsections")
				.setDesc(
					"Also include the section’s subsections (requires target to be a heading starting with #). Subsections are headings inside the section.",
				)
				.addToggle((toggle) =>
					toggle
						.setValue(this.choice.insertAfter?.considerSubsections)
						.onChange((value) => {
							if (!value) {
								this.choice.insertAfter.considerSubsections = false;
								return;
							}

							const targetIsHeading =
								this.choice.insertAfter.after.startsWith("#");
							if (targetIsHeading) {
								this.choice.insertAfter.considerSubsections = value;
							} else {
								this.choice.insertAfter.considerSubsections = false;
								// reset the toggle to match state and inform user
								toggle.setValue(false);
								new Notice(
									"Consider subsections requires the target to be a heading (starts with #)",
								);
							}
						}),
				);
		}

		const createLineIfNotFound: Setting = new Setting(this.contentEl);
		createLineIfNotFound
			.setName("Create line if not found")
			.setDesc("Creates the 'insert after' line if it is not found.")
			.addToggle((toggle) => {
				if (!this.choice.insertAfter?.createIfNotFound)
					this.choice.insertAfter.createIfNotFound = false; // Set to default

				toggle
					.setValue(this.choice.insertAfter?.createIfNotFound)
					.onChange(
						(value) => (this.choice.insertAfter.createIfNotFound = value),
					).toggleEl.style.marginRight = "1em";
			})
			.addDropdown((dropdown) => {
				if (!this.choice.insertAfter?.createIfNotFoundLocation)
					this.choice.insertAfter.createIfNotFoundLocation =
						CREATE_IF_NOT_FOUND_TOP; // Set to default

				dropdown
					.addOption(CREATE_IF_NOT_FOUND_TOP, "Top")
					.addOption(CREATE_IF_NOT_FOUND_BOTTOM, "Bottom")
					.addOption(CREATE_IF_NOT_FOUND_CURSOR, "Cursor")
					.setValue(this.choice.insertAfter?.createIfNotFoundLocation)
					.onChange(
						(value) =>
							(this.choice.insertAfter.createIfNotFoundLocation = value),
					);
			});
	}

	private addFormatSetting() {
		const enableSetting = new Setting(this.contentEl);
		enableSetting
			.setName("Capture format")
			.setDesc("Set the format of the capture.")
			.addToggle((toggleComponent) => {
				toggleComponent
					.setValue(this.choice.format.enabled)
					.onChange((value) => {
						this.choice.format.enabled = value;
						formatHandle.setDisabled(!value);
						formatHandle.setRequired(value);
					});
			});

		const displayFormatter: FormatDisplayFormatter = new FormatDisplayFormatter(
			this.app,
			this.plugin,
		);

		const previewRow = this.contentEl.createDiv({ cls: "qa-preview-row" });
		previewRow.createEl("span", { text: "Preview: ", cls: "qa-preview-label" });
		const formatDisplay = previewRow.createEl("span");
		formatDisplay.setAttr("aria-live", "polite");
		formatDisplay.innerText = "Loading preview…";

		const formatHandle = createValidatedInput({
			app: this.app,
			parent: this.contentEl,
			inputKind: "textarea",
			initialValue: this.choice.format.format,
			placeholder: "Format",
			required: this.choice.format.enabled,
			requiredMessage: "Capture format is required when enabled",
			attachSuggesters: [
				(el) => new FormatSyntaxSuggester(this.app, el, this.plugin),
			],
			onChange: async (value) => {
				this.choice.format.format = value;
				try {
					formatDisplay.innerText = await displayFormatter.format(value);
				} catch {
					formatDisplay.innerText = "Preview unavailable";
				}
			},
		});

		formatHandle.setDisabled(!this.choice.format.enabled);

		void (async () => {
			try {
				formatDisplay.innerText = await displayFormatter.format(
					this.choice.format.format,
				);
			} catch {
				formatDisplay.innerText = "Preview unavailable";
			}
		})();
	}

	private addCreateIfNotExistsSetting() {
		if (!this.choice.createFileIfItDoesntExist)
			this.choice.createFileIfItDoesntExist = {
				enabled: false,
				createWithTemplate: false,
				template: "",
			};

		const createFileIfItDoesntExist: Setting = new Setting(this.contentEl);
		createFileIfItDoesntExist
			.setName("Create file if it doesn't exist")
			.addToggle((toggle) =>
				toggle
					.setValue(this.choice?.createFileIfItDoesntExist?.enabled)
					.setTooltip("Create file if it doesn't exist")
					.onChange((value) => {
						this.choice.createFileIfItDoesntExist.enabled = value;
						this.reload();
					}),
			);
	}

	private addCreateWithTemplateSetting() {
		let templateSelector: TextComponent;
		const createWithTemplateSetting = new Setting(this.contentEl);
		createWithTemplateSetting
			.setName("Create file with given template.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.choice.createFileIfItDoesntExist?.createWithTemplate)
					.onChange((value) => {
						this.choice.createFileIfItDoesntExist.createWithTemplate = value;
						templateSelector.setDisabled(!value);
					}),
			);

		const templateFilePaths: string[] = this.plugin
			.getTemplateFiles()
			.map((f) => f.path);

		const templateSelectorHandle = createValidatedInput({
			app: this.app,
			parent: this.contentEl,
			initialValue: this.choice?.createFileIfItDoesntExist?.template ?? "",
			placeholder: "Template path",
			suggestions: templateFilePaths,
			maxSuggestions: 50,
			validator: (raw) => {
				const v = raw.trim();
				if (!v) return true;
				return templateFilePaths.includes(v) || "Template not found";
			},
			onChange: (value) => {
				this.choice.createFileIfItDoesntExist.template = value;
			},
		});

		templateSelectorHandle.setDisabled(
			!this.choice?.createFileIfItDoesntExist?.createWithTemplate,
		);

		templateSelector = templateSelectorHandle.component as TextComponent;
	}
}
