import { App, MarkdownRenderer, Modal, Notice, Component } from "obsidian";
import { waitFor } from "src/utility";

/**
 * Modal that continuously updates with partial response chunks from the AI.
 * Users can copy the growing response or cancel generation.
 */
export class StreamingResponseModal extends Modal {
    private responseContainerEl!: HTMLElement;
    private tokenCountEl!: HTMLElement;
    private copyButtonEl!: HTMLButtonElement;
    private stopButtonEl!: HTMLButtonElement;

    private currentText = "";
    private _onStop?: () => void;

    constructor(app: App, onStop?: () => void) {
        super(app);
        this._onStop = onStop;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();

        // Header
        contentEl.createEl("h2", { text: "AI Assistant Response" });

        // Response container (scrollable, markdown-rendered)
        const wrapper = contentEl.createDiv({ cls: "ai-response-container" });
        this.responseContainerEl = wrapper.createDiv({ cls: "ai-response-content" });
        this.responseContainerEl.style.maxHeight = "60vh";
        this.responseContainerEl.style.overflowY = "auto";

        // Footer actions
        const footer = contentEl.createDiv({ cls: "ai-response-footer" });

        this.tokenCountEl = footer.createSpan({ cls: "token-count" });

        this.copyButtonEl = footer.createEl("button", { text: "Copy Response", cls: "mod-cta" });
        this.copyButtonEl.addEventListener("click", () => {
            navigator.clipboard.writeText(this.currentText);
            new Notice("Response copied to clipboard");
        });

        this.stopButtonEl = footer.createEl("button", { text: "Stop", cls: "mod-warning" });
        this.stopButtonEl.addEventListener("click", () => {
            if (this._onStop) this._onStop();
            this.close();
        });
    }

    onClose(): void {
        // Clean up DOM
        const { contentEl } = this;
        contentEl.empty();
    }

    /**
     * Update modal with newly accumulated text.
     */
    async updateContent(fullText: string): Promise<void> {
        this.currentText = fullText;
        // Render markdown (async) – keep it simple for now.
        this.responseContainerEl.empty();
        await MarkdownRenderer.renderMarkdown(fullText, this.responseContainerEl, "", new Component());

        // Update token estimate – rough approximation using word count.
        const approxTokens = Math.round(fullText.split(/\s+/).length * 1.35);
        this.tokenCountEl.textContent = `~${approxTokens} tokens`;

        // Auto-scroll to bottom
        await waitFor(0);
        this.responseContainerEl.scrollTop = this.responseContainerEl.scrollHeight;
    }
}