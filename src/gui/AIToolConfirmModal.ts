import type { App } from "obsidian";
import { ButtonComponent, Modal } from "obsidian";

export type ToolConfirmOutcome = "allow" | "allow-all" | "deny" | "abort";

/**
 * Confirmation modal for an AI-requested tool call (#714). The model chose the tool
 * and its arguments, so this is the human-in-the-loop checkpoint. Outcomes:
 *  - allow      run this one call
 *  - allow-all  run this and every later call this run (no more prompts)
 *  - deny       skip this call (the model gets an isError result and can adapt)
 *  - abort      cancel the whole AI run
 *
 * The safe option (Deny) is focused by default; Approve is NOT painted as the
 * bright primary CTA, so visual emphasis matches the safe-by-default intent (the
 * model — not the user — chose this action). The model-chosen target (path/heading)
 * is surfaced as a labeled summary above the raw args so the dangerous detail is
 * reviewable at a glance instead of buried in a JSON blob.
 * Dismissing (Esc / click-out) resolves to "deny" — declining THIS call, NOT
 * aborting the run (use the explicit Abort button for that).
 */
export default class AIToolConfirmModal extends Modal {
	private resolvePromise!: (outcome: ToolConfirmOutcome) => void;
	public waitForClose: Promise<ToolConfirmOutcome>;
	private outcome: ToolConfirmOutcome | null = null;

	public static Prompt(
		app: App,
		toolName: string,
		args: unknown,
	): Promise<ToolConfirmOutcome> {
		return new AIToolConfirmModal(app, toolName, args).waitForClose;
	}

	private constructor(
		app: App,
		private toolName: string,
		private args: unknown,
	) {
		super(app);
		this.waitForClose = new Promise<ToolConfirmOutcome>((resolve) => {
			this.resolvePromise = resolve;
		});
		this.open();
		this.display();
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "qaAIToolConfirm");
		this.contentEl.empty();
		this.titleEl.textContent = `Run AI tool: ${this.toolName}?`;

		this.contentEl.createEl("p", {
			text: "The AI requested this tool call with the arguments below.",
		});

		// Surface the model-chosen target (path/heading) as a labeled line so the
		// safety-critical detail is reviewable without parsing the JSON.
		const summary = summarizeToolCall(this.toolName, this.args);
		if (summary) {
			this.contentEl.createEl("p", {
				cls: "qaAIToolSummary",
				text: summary,
			});
		}

		const pre = this.contentEl.createEl("pre", { cls: "qaAIToolArgs" });
		pre.textContent = safeStringify(this.args);
		// No CSS ships for .qaAIToolArgs (the only styled `pre` is scoped to
		// .quickadd-update-modal), so wrap + scroll inline — otherwise a long
		// content string runs off the modal edge and can't be reviewed.
		pre.setCssStyles({
			whiteSpace: "pre-wrap",
			wordBreak: "break-word",
			maxHeight: "16rem",
			overflowY: "auto",
		});

		const buttons = this.contentEl.createDiv({
			cls: "yesNoPromptButtonContainer",
		});

		const abortBtn = new ButtonComponent(buttons)
			.setButtonText("Abort run")
			.onClick(() => this.submit("abort"));
		const denyBtn = new ButtonComponent(buttons)
			.setButtonText("Deny")
			.onClick(() => this.submit("deny"));
		const allowAllBtn = new ButtonComponent(buttons)
			.setButtonText("Approve all this run")
			.onClick(() => this.submit("allow-all"));
		// Deliberately NOT .setCta(): Approve runs a model-chosen action, so it must
		// not be the bright primary button competing with the focused, safe Deny.
		const allowBtn = new ButtonComponent(buttons)
			.setButtonText("Approve")
			.onClick(() => this.submit("allow"));

		// Focus the safe option.
		denyBtn.buttonEl.focus();
		addArrowKeyNavigation([
			abortBtn.buttonEl,
			denyBtn.buttonEl,
			allowAllBtn.buttonEl,
			allowBtn.buttonEl,
		]);
	}

	private submit(outcome: ToolConfirmOutcome) {
		this.outcome = outcome;
		this.close();
	}

	onClose() {
		super.onClose();
		// Dismiss without an explicit choice = decline THIS call (not abort).
		this.resolvePromise(this.outcome ?? "deny");
	}
}

/**
 * Build a one-line, plain-language summary of what a tool call will touch, from the
 * model-chosen args. Pure (no DOM) so it is unit-testable. Returns "" when no
 * recognizable target field is present (the raw args still render below it).
 */
export function summarizeToolCall(toolName: string, args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	const path = typeof record.path === "string" ? record.path.trim() : "";
	const heading = typeof record.heading === "string" ? record.heading.trim() : "";
	if (!path && !heading) return "";
	const parts: string[] = [];
	if (path) parts.push(`Target: ${path}`);
	if (heading) parts.push(`Heading: ${heading}`);
	return parts.join("  ·  ");
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		return String(value);
	}
}

function addArrowKeyNavigation(buttons: HTMLButtonElement[]): void {
	buttons.forEach((button) => {
		button.addEventListener("keydown", (event) => {
			if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
				const currentIndex = buttons.indexOf(button);
				const nextIndex =
					(currentIndex +
						(event.key === "ArrowRight" ? 1 : -1) +
						buttons.length) %
					buttons.length;
				buttons[nextIndex].focus();
				event.preventDefault();
			}
		});
	});
}
