import type { App, Debouncer } from "obsidian";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { parseNaturalLanguageDate } from "../../utils/dateParser";
import { debounce } from "obsidian";

export default class VDateInputPrompt extends GenericInputPrompt {
	private previewEl: HTMLElement;
	private dateFormat: string;
	private updatePreviewDebounced: Debouncer<[], void>;
	private currentInput = "";
	private isOpen = true;

	public static Prompt(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
		dateFormat?: string
	): Promise<string> {
		const newPromptModal = new VDateInputPrompt(
			app,
			header,
			placeholder,
			value,
			dateFormat
		);
		return newPromptModal.waitForClose;
	}

	protected constructor(
		app: App,
		header: string,
		placeholder?: string,
		value?: string,
		dateFormat?: string
	) {
		super(app, header, placeholder, value);
		this.dateFormat = dateFormat || "YYYY-MM-DD";
		
		// Create debounced preview update function (250ms delay, reset on each call)
		this.updatePreviewDebounced = debounce(
			this.updatePreview.bind(this),
			250,
			true
		);
	}

	protected createInputField(
		container: HTMLElement,
		placeholder?: string,
		value?: string
	) {
		const textComponent = super.createInputField(container, placeholder, value);
		
		// Create preview element
		this.createPreviewElement(container);
		
		// Track input changes
		textComponent.onChange((newValue) => {
			this.currentInput = newValue;
			this.updatePreviewDebounced();
		});
		
		// Initial preview if there's a default value
		if (value) {
			this.currentInput = value;
			this.updatePreview();
		}
		
		return textComponent;
	}

	private createPreviewElement(container: HTMLElement) {
		const previewContainer = container.createDiv("vdate-preview-container");
		previewContainer.style.marginTop = "0.5rem";
		previewContainer.style.padding = "0.5rem";
		previewContainer.style.backgroundColor = "var(--background-modifier-form-field)";
		previewContainer.style.borderRadius = "4px";
		previewContainer.style.fontSize = "0.9em";
		
		const previewLabel = previewContainer.createEl("div", {
			text: "Preview:",
			cls: "vdate-preview-label"
		});
		previewLabel.style.fontWeight = "600";
		previewLabel.style.marginBottom = "0.25rem";
		previewLabel.style.color = "var(--text-muted)";
		
		this.previewEl = previewContainer.createEl("div", {
			cls: "vdate-preview-text"
		});
		this.previewEl.style.fontFamily = "var(--font-monospace)";
		this.setPreviewText("Preview will appear here", false);
	}

	private updatePreview() {
		// Don't update if modal is closed
		if (!this.isOpen) return;
		
		const input = this.currentInput.trim();
		
		if (!input) {
			this.setPreviewText("Preview will appear here", false);
			return;
		}
		
		const parseResult = parseNaturalLanguageDate(input, this.dateFormat);
		
		if (parseResult.isValid && parseResult.formatted) {
			this.setPreviewText(parseResult.formatted, false);
		} else {
			const errorMessage = parseResult.error || "Unable to parse date";
			this.setPreviewText(errorMessage, true);
		}
	}

	private setPreviewText(text: string, isError: boolean) {
		this.previewEl.setText(text);
		
		if (isError) {
			this.previewEl.style.color = "var(--text-error)";
		} else {
			this.previewEl.style.color = "var(--text-normal)";
		}
	}

	onClose() {
		// Prevent any pending debounced updates
		this.isOpen = false;
		
		// Cancel any pending debounced calls
		this.updatePreviewDebounced.cancel();
		
		super.onClose();
	}
}