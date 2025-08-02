import type { App, Debouncer } from "obsidian";
import { TextComponent, debounce } from "obsidian";
import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
import { parseNaturalLanguageDate } from "../../utils/dateParser";

export default class VDateInputPrompt extends GenericInputPrompt {
	private previewEl: HTMLElement;
	private dateFormat: string;
	private updatePreviewDebounced: Debouncer<[], void>;
	private currentInput: string;
	private isOpen = true;
	private defaultValue: string | undefined;
	private static readonly PREVIEW_PLACEHOLDER = "Preview will appear here";

	public static Prompt(
		app: App,
		header: string,
		placeholder?: string,
		defaultValue?: string,
		dateFormat?: string
	): Promise<string> {
		const newPromptModal = new VDateInputPrompt(
			app,
			header,
			placeholder,
			defaultValue,
			dateFormat
		);
		return newPromptModal.waitForClose;
	}

	protected constructor(
		app: App,
		header: string,
		placeholder?: string,
		defaultValue?: string,
		dateFormat?: string
	) {
		// Pass the defaultValue to the parent so the input box is pre-filled
		super(app, header, placeholder, defaultValue ?? "");
		
		this.dateFormat = dateFormat || "YYYY-MM-DD";
		this.defaultValue = defaultValue;
		this.currentInput = defaultValue ?? "";
		
		// Create debounced preview update function (250ms delay, reset on each call)
		this.updatePreviewDebounced = debounce(
			this.updatePreview.bind(this),
			250,
			true // Reset timer on each call (standard debounce behavior)
		);

		// Trigger initial preview update now that all fields are properly set
		if (this.defaultValue) {
			this.updatePreview();
		}
	}

	protected createInputField(
		container: HTMLElement,
		placeholder?: string,
		value?: string
	) {
		// Create TextComponent directly to avoid duplicate onChange listeners
		const textComponent = new TextComponent(container);
		
		textComponent.inputEl.style.width = "100%";
		textComponent
			.setPlaceholder(placeholder ?? "")
			.setValue(value ?? "")
			.onChange((newValue) => {
				this.currentInput = newValue;
				this.input = newValue; // Keep parent's input in sync  
				this.updatePreviewDebounced();
			})
			.inputEl.addEventListener("keydown", this.submitEnterCallback);
		
		// Initialize currentInput with the initial value (which should be defaultValue)
		this.currentInput = value ?? "";
		
		// Create preview element
		this.createPreviewElement(container);
		
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
		this.previewEl.textContent = VDateInputPrompt.PREVIEW_PLACEHOLDER;
		this.previewEl.style.color = "var(--text-normal)";
	}

	private updatePreview() {
		// Don't update if modal is closed
		if (!this.isOpen) return;
		
		const input = this.currentInput.trim();
		
		// If no input and we have a default, show preview for default
		if (!input && this.defaultValue) {
			this.renderPreview(this.defaultValue);
			return;
		}
		
		if (!input) {
			this.setPreviewText(VDateInputPrompt.PREVIEW_PLACEHOLDER, false);
			return;
		}
		
		// If input matches default value or regular input, render the preview
		this.renderPreview(input);
	}

	private renderPreview(value: string) {
		const parseResult = parseNaturalLanguageDate(value, this.dateFormat);
		
		if (parseResult.isValid && parseResult.formatted) {
			this.setPreviewText(parseResult.formatted, false);
		} else {
			const errorMessage = parseResult.error || "Unable to parse date";
			this.setPreviewText(errorMessage, true);
		}
	}

	private setPreviewText(text: string, isError: boolean) {
		this.previewEl.textContent = text;
		
		if (isError) {
			this.previewEl.style.color = "var(--text-error)";
		} else {
			this.previewEl.style.color = "var(--text-normal)";
		}
	}

	onOpen() {
		super.onOpen();
	}

	onClose() {
		// Prevent any pending debounced updates
		this.isOpen = false;
		
		// Cancel any pending debounced calls
		this.updatePreviewDebounced.cancel();
		
		// If input is empty and we have a default, use the default
		if (!this.input.trim() && this.defaultValue) {
			this.input = this.defaultValue;
		}
		
		super.onClose();
	}
}