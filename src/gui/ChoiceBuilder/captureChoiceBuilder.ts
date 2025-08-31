import type { App } from "obsidian";
import {
	Notice,
	Setting,
	TextAreaComponent,
	TextComponent,
	ToggleComponent,
} from "obsidian";
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
import type { LinkPlacement } from "../../types/linkPlacement";
import { normalizeAppendLinkOptions } from "../../types/linkPlacement";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";
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
		this.addOnePageOverrideSetting(this.choice);
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

			// Preview row
			const previewRow = captureToFileContainer.createDiv({ cls: "qa-preview-row" });
			previewRow.createEl("span", { text: "Preview: ", cls: "qa-preview-label" });
			const formatDisplay = previewRow.createEl("span");
			formatDisplay.setAttr("aria-live", "polite");
			const displayFormatter: FileNameDisplayFormatter =
				new FileNameDisplayFormatter(this.app);
			formatDisplay.textContent = "Loading preview…";
			void (async () => {
				try {
					formatDisplay.textContent = await displayFormatter.format(
						this.choice.captureTo,
					);
				} catch {
					formatDisplay.textContent = "Preview unavailable";
				}
			})();

			// Search input using idiomatic Obsidian Setting
			new Setting(captureToFileContainer)
				.setName("File path / format")
				.setDesc("Choose a file or use format syntax (e.g., {{DATE}})")
				.addSearch((search) => {
					search.setValue(this.choice.captureTo);
					search.setPlaceholder("File name format");
					const markdownFilesAndFormatSyntax = [
						...this.app.vault.getMarkdownFiles().map((f) => f.path),
						...FILE_NAME_FORMAT_SYNTAX,
					];
					new GenericTextSuggester(
						this.app,
						search.inputEl,
						markdownFilesAndFormatSyntax,
						50,
					);
					search.onChange(async (value) => {
						this.choice.captureTo = value;
						try {
							formatDisplay.textContent = await displayFormatter.format(value);
						} catch {
							formatDisplay.textContent = "Preview unavailable";
						}
					});
					new FormatSyntaxSuggester(this.app, search.inputEl, this.plugin);
				});
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

		const appendLinkSetting: Setting = new Setting(this.contentEl);
		appendLinkSetting
			.setName("Append link to note")
			.setDesc("Insert a link in the current note to the captured file.")
			.addToggle((toggle) => {
				toggle.setValue(normalizedOptions.enabled);
				toggle.onChange((value) => {
					if (value) {
						// When enabling, use the new object format
						this.choice.appendLink = {
							enabled: true,
							placement: normalizedOptions.placement,
						};
					} else {
						// When disabling, keep as boolean for simplicity and backward compatibility
						this.choice.appendLink = false;
					}
					this.reload();
				});
			});

		// Only show placement dropdown when append link is enabled
		if (normalizedOptions.enabled) {
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
						// Ensure we update the choice with object format when placement changes
						this.choice.appendLink = {
							enabled: true,
							placement: value,
						};
					});
				});
		}
	}

	private addWritePositionSetting() {
		const positionSetting: Setting = new Setting(this.contentEl);
		const isActiveFile = !!this.choice?.captureToActiveFile;
		positionSetting
			.setName("Write position")
			.setDesc(
				isActiveFile
					? "Where to place the capture in the current file."
					: "Where to place the capture in the target file.",
			)
			.addDropdown((dropdown) => {
				const current: "top" | "after" | "bottom" | "newLineAbove" | "newLineBelow" =
					this.choice.insertAfter?.enabled
						? "after"
						: this.choice.prepend
							? "bottom"
							: this.choice.newLineCapture?.enabled
								? this.choice.newLineCapture.direction === "above"
									? "newLineAbove"
									: "newLineBelow"
								: "top";

				dropdown.addOption("top", isActiveFile ? "At cursor" : "Top of file");

				// Add new line options only when capturing to active file
				if (isActiveFile) {
					dropdown.addOption("newLineAbove", "New line above cursor");
					dropdown.addOption("newLineBelow", "New line below cursor");
				}
				
				dropdown.addOption("after", "After line…");
				dropdown.addOption("bottom", "Bottom of file");
				dropdown.setValue(current);
				dropdown.onChange((value: string) => {
					const v = value as "top" | "after" | "bottom" | "newLineAbove" | "newLineBelow";
					
					// Reset all options first
					this.choice.prepend = false;
					this.choice.insertAfter.enabled = false;
					if (!this.choice.newLineCapture) {
						this.choice.newLineCapture = { enabled: false, direction: "below" };
					}
					this.choice.newLineCapture.enabled = false;
					
					if (v === "top") {
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
		// Build a desc fragment with static help + live preview
		const descFragment = document.createDocumentFragment();
		const descText = document.createElement("div");
		descText.textContent =
			"Insert capture after specified line. Accepts format syntax. Tip: use a heading (starts with #) to target a section.";
		descFragment.appendChild(descText);

		const previewRow = document.createElement("div");
		previewRow.classList.add("qa-preview-row");
		const previewLabel = document.createElement("span");
		previewLabel.textContent = "Preview: ";
		previewLabel.classList.add("qa-preview-label");
		const previewValue = document.createElement("span");
		previewValue.setAttribute("aria-live", "polite");
		previewRow.appendChild(previewLabel);
		previewRow.appendChild(previewValue);
		descFragment.appendChild(previewRow);

		const displayFormatter: FormatDisplayFormatter = new FormatDisplayFormatter(
			this.app,
			this.plugin,
		);
		previewValue.innerText = "Loading preview…";
		void (async () => {
			try {
				previewValue.innerText = await displayFormatter.format(
					this.choice.insertAfter.after,
				);
			} catch {
				previewValue.innerText = "Preview unavailable";
			}
		})();

		new Setting(this.contentEl)
			.setName("Insert after")
			.setDesc(descFragment)
			.addText((text) => {
				text.setPlaceholder("Insert after");
				text.inputEl.style.width = "100%";
				text.setValue(this.choice.insertAfter.after).onChange(async (value) => {
					this.choice.insertAfter.after = value;
					try {
						previewValue.innerText = await displayFormatter.format(value);
					} catch {
						previewValue.innerText = "Preview unavailable";
					}
				});

				new FormatSyntaxSuggester(this.app, text.inputEl, this.plugin);
			});

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
		let textField: TextAreaComponent;
		const enableSetting = new Setting(this.contentEl);
		enableSetting
			.setName("Capture format")
			.setDesc("Set the format of the capture.")
			.addToggle((toggleComponent) => {
				toggleComponent
					.setValue(this.choice.format.enabled)
					.onChange((value) => {
						this.choice.format.enabled = value;
						textField.setDisabled(!value);
					});
			});

		const formatInput = new TextAreaComponent(this.contentEl);
		formatInput.setPlaceholder("Format");
		textField = formatInput;
		formatInput.inputEl.style.width = "100%";
		formatInput.inputEl.style.marginBottom = "8px";
		formatInput.inputEl.style.height = "10rem";
		formatInput.inputEl.style.minHeight = "10rem";
		formatInput
			.setValue(this.choice.format.format)
			.setDisabled(!this.choice.format.enabled);

		formatInput.onChange(async (value) => {
			this.choice.format.format = value;
			try {
				formatDisplay.innerText = await displayFormatter.format(value);
			} catch {
				formatDisplay.innerText = "Preview unavailable";
			}
		});

		new FormatSyntaxSuggester(this.app, textField.inputEl, this.plugin);

		const formatDisplay: HTMLSpanElement = this.contentEl.createEl("span");
		formatDisplay.setAttr("aria-live", "polite");
		const displayFormatter: FormatDisplayFormatter = new FormatDisplayFormatter(
			this.app,
			this.plugin,
		);
		formatDisplay.innerText = "Loading preview…";
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

		templateSelector = new TextComponent(this.contentEl);
		templateSelector
			.setValue(this.choice?.createFileIfItDoesntExist?.template ?? "")
			.setPlaceholder("Template path")
			.setDisabled(!this.choice?.createFileIfItDoesntExist?.createWithTemplate);

		templateSelector.inputEl.style.width = "100%";
		templateSelector.inputEl.style.marginBottom = "8px";

		const templateFilePaths: string[] = this.plugin
			.getTemplateFiles()
			.map((f) => f.path);
		new GenericTextSuggester(
			this.app,
			templateSelector.inputEl,
			templateFilePaths,
			50,
		);

		templateSelector.onChange((value) => {
			this.choice.createFileIfItDoesntExist.template = value;
		});
	}
}
