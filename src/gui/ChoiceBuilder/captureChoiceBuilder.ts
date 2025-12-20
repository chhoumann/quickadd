import type { App, TextComponent } from "obsidian";
import { Notice, Setting, ToggleComponent } from "obsidian";
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
		this.addTemplaterAfterCaptureSetting();
		if (!this.choice.captureToActiveFile) {
			this.addOpenFileSetting("Open the captured file.");

			if (this.choice.openFile) {
				this.addFileOpeningSetting("captured");
			}
		}
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

	private addCapturedToSetting() {
		new Setting(this.contentEl)
			.setName("Capture to")
			.setDesc("Target file path. Supports format syntax.");

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
			const captureToFileContainer: HTMLDivElement =
				captureToContainer.createDiv("captureToFileContainer");

			new Setting(captureToFileContainer)
				.setName("File path / format")
				.setDesc("Choose a file or use format syntax (e.g., {{DATE}})");

			const displayFormatter: FileNameDisplayFormatter =
				new FileNameDisplayFormatter(this.app, this.plugin);

			const previewRow = captureToFileContainer.createDiv({ cls: "qa-preview-row" });
			previewRow.createEl("span", { text: "Preview: ", cls: "qa-preview-label" });
			const formatDisplay = previewRow.createEl("span");
			formatDisplay.setAttr("aria-live", "polite");
			formatDisplay.textContent = "Loading preview…";

			const markdownFilesAndFormatSyntax = [
				...this.app.vault.getMarkdownFiles().map((f) => f.path),
				...FILE_NAME_FORMAT_SYNTAX,
			];

			createValidatedInput({
				app: this.app,
				parent: captureToFileContainer,
				initialValue: this.choice.captureTo,
				placeholder: "File name format",
				suggestions: markdownFilesAndFormatSyntax,
				maxSuggestions: 50,
				attachSuggesters: [
					(el) => new FormatSyntaxSuggester(this.app, el, this.plugin),
				],
				onChange: async (value) => {
					this.choice.captureTo = value;
					try {
						formatDisplay.textContent = await displayFormatter.format(value);
					} catch {
						formatDisplay.textContent = "Preview unavailable";
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
		}
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
				const current =
					this.choice.insertAfter?.enabled
						? "after"
						: this.choice.prepend
							? "bottom"
							: this.choice.newLineCapture?.enabled
								? this.choice.newLineCapture.direction === "above"
									? "newLineAbove"
									: "newLineBelow"
								: isActiveFile && this.choice.activeFileWritePosition === "top"
									? "activeTop"
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
						this.choice.prepend = true;
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
	}

	private addInsertAfterFields() {
		const descText =
			"Insert capture after specified line. Accepts format syntax. " +
			"Tip: use a heading (starts with #) to target a section. " +
			"If the matched line is followed by blank lines, QuickAdd inserts after them to preserve spacing.";

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
			requiredMessage: "Insert after line is required",
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

		const insertAtEndSetting: Setting = new Setting(this.contentEl);
		insertAtEndSetting
			.setName("Insert at end of section")
			.setDesc(
				"Place the text at the end of the matched section instead of the top.",
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.choice.insertAfter?.insertAtEnd)
					.onChange((value) => (this.choice.insertAfter.insertAtEnd = value)),
			);

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
