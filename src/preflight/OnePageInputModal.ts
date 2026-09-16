import { OnePageFieldRenderer, type FieldControl } from "./OnePageFieldRenderer";
import {
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextComponent,
	debounce,
	type App,
} from "obsidian";
import { InputPromptPeek } from "src/gui/promptPeek/InputPromptPeek";
import {
	applyCompactPromptChrome,
	stylePeekButton,
} from "src/gui/promptPeek/stylePeekButton";
import { PEEK_SHORTCUT_KEY } from "src/gui/promptShortcuts";
import { FileSuggester } from "src/gui/suggesters/fileSuggester";
import { TagSuggester } from "src/gui/suggesters/tagSuggester";
import type { FieldGroup, FieldRequirement } from "./RequirementCollector";
import type { ImagePasteHandle } from "src/gui/imagePasteHandler";
import { attachImagePasteHandler } from "src/gui/imagePasteHandler";
import { promptCancelled } from "../errors/UserCancelError";
import { renderOnePagePreview, type PreviewRow } from "./onePagePreview";
export type { PreviewRow } from "./onePagePreview";
import { NoteDiscoveryInputSuggest } from "src/gui/suggesters/NoteDiscoveryInputSuggest";
import { createTemplateNoteSelection, type TemplateNoteSelection } from "src/utils/templateNoteDiscovery";
import { acceptsDiscoverySelection, resolveDiscoveryFieldRequirement, type DiscoveryFormConfig, type DiscoveryNoteField } from "./discoveryFormPlan";
import { existingNoteActionVerb } from "src/template/fileExistsPolicy";

type OnePageFreeTextField = {
	id: string;
	el: HTMLInputElement | HTMLTextAreaElement;
	fileSuggester: FileSuggester;
	tagSuggester: TagSuggester;
};


type RequirementRun = {
	group: FieldGroup | undefined;
	fields: FieldRequirement[];
};

function groupRequirements(requirements: FieldRequirement[]): RequirementRun[] {
	const runs: RequirementRun[] = [];
	for (const field of requirements) {
		const last = runs.at(-1);
		if (last && last.group?.id === field.group?.id) {
			last.fields.push(field);
		} else {
			runs.push({ group: field.group, fields: [field] });
		}
	}
	return runs;
}

function hasMultipleGroups(requirements: FieldRequirement[]): boolean {
	const ids = new Set<string>();
	for (const field of requirements) {
		if (field.group) ids.add(field.group.id);
	}
	return ids.size >= 2;
}

type PreviewComputer = (
	values: Record<string, unknown>,
) => Promise<PreviewRow[]> | PreviewRow[];


function controlDefinition(requirement: FieldRequirement): string {
	return JSON.stringify(Object.entries(requirement)
		.filter(([key, value]) => value !== undefined && !["id", "group", "optional", "pathContext", "runtimeOnly"].includes(key))
		.sort(([a], [b]) => a.localeCompare(b)));
}

export class OnePageInputModal extends Modal {
	private readonly requirements: FieldRequirement[];
	private readonly initialValues: Map<string, string>;
	private readonly result = new Map<string, string>();
	// Unambiguous ordered selections per multi-select field, recorded per-pick from
	// the suggester (see SuggesterInputSuggest.onSelect). The ", "-joined input
	// text alone can't distinguish picking "a" then "b" from picking a single
	// option named "a, b"; consumers prefer this array when it still matches the
	// final text (pure click flow), falling back to text parsing after manual edits.
	public readonly multiSelections = new Map<string, string[]>();
	// FILE selections stay structured and path-backed even though the public
	// requestInputs result remains string-based. runOnePagePreflight consumes this
	// map before the formatter renders name/link/path output.
	public readonly fileSelections = new Map<string, string[]>();
	public readonly discoverySelections = new Map<string, TemplateNoteSelection>();
	private readonly discoverySuggesters: NoteDiscoveryInputSuggest[] = [];
	private readonly fieldElements = new Map<string, HTMLElement[]>();
	private readonly fieldAnchors = new Map<string, Comment>();
	private readonly fieldControls = new Map<FieldRequirement, FieldControl>();
	private readonly discoveryInputs = new Map<string, {
		input: HTMLInputElement;
		select: (selection: TemplateNoteSelection) => void;
		resolve: () => TemplateNoteSelection;
	}>();
	// Date fields whose current (non-blank) text failed to parse.
	private readonly dateParseErrors = new Set<string>();
	private readonly computePreview?: PreviewComputer;
	private previewContainerEl: HTMLElement | null = null;
	/** Monotonic guard so a slow preview pass cannot commit over a newer one. */
	private previewToken = 0;
	private updatePreviewDebounced: () => void;
	private settled = false;
	private readonly imagePasteHandles = new Map<FieldRequirement, ImagePasteHandle>();
	private readonly imagePasteInputs = new Map<FieldRequirement, HTMLInputElement | HTMLTextAreaElement>();
	private readonly freeTextFields: OnePageFreeTextField[] = [];
	private lastFocusedFreeText: OnePageFreeTextField | undefined;
	private readonly peek: InputPromptPeek;

	public waitForClose: Promise<Record<string, string>>;
	private resolvePromise!: (values: Record<string, string>) => void;
	private rejectPromise!: (reason?: unknown) => void;

	constructor(
		app: App,
		requirements: FieldRequirement[],
		initial?: Map<string, unknown>,
		computePreview?: PreviewComputer,
		private readonly discoveryForm?: DiscoveryFormConfig,
	) {
		super(app);
		this.requirements = requirements.map((requirement) => ({ ...requirement }));
		this.updateFieldMetadata();
		this.initialValues = new Map<string, string>();
		this.computePreview = computePreview;
		initial?.forEach((v, k) => {
			if (typeof v === "string") this.initialValues.set(k, v);
		});

		this.updatePreviewDebounced = debounce(
			this.updatePreviews.bind(this),
			150,
			true,
		);
		this.peek = new InputPromptPeek({
			app,
			title: "Provide inputs",
			containerEl: this.containerEl,
			scope: this.scope,
			getField: () => this.insertTarget()?.el,
			getValue: () => this.insertTarget()?.el.value ?? "",
			setValue: (value) => {
				const target = this.insertTarget();
				if (!target) return;
				this.result.set(target.id, value);
				this.updatePreviewDebounced();
			},
			persistDraft: () => {},
			markDraftChanged: () => {
				const target = this.insertTarget();
				if (!target) return;
				this.result.set(target.id, target.el.value);
				this.updatePreviewDebounced();
			},
			close: () => this.close(),
		});

		this.waitForClose = new Promise<Record<string, string>>(
			(resolve, reject) => {
				this.resolvePromise = resolve;
				this.rejectPromise = reject;
			},
		);

		this.display();
		this.open();
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "onePageInputModal");
		applyCompactPromptChrome(this.containerEl);
		if (this.discoveryForm) this.containerEl.addClass("qa-discovery-form");
		this.contentEl.empty();

		const title = this.contentEl.createEl("h2", { text: "Provide inputs" });
		title.addClass("qa-onepage-title");

		// Optional live preview area. Created (empty and collapsed) before the
		// fields so it keeps its place between the title and the first input; the
		// standing "Preview" heading is gone, because each row now carries its own
		// label and a heading reading "Preview" would re-assert the promise
		// "Won't be created:" exists to withdraw (#1590/#1594).
		if (this.computePreview) {
			this.previewContainerEl = this.contentEl.createDiv();
			this.previewContainerEl.addClass("qa-onepage-preview", "qa-hidden");
		}

		if (hasMultipleGroups(this.requirements)) {
			for (const run of groupRequirements(this.requirements)) {
				if (run.group && !(this.discoveryForm && run.fields.length === 1 && run.fields[0].label === run.group.label)) {
					this.contentEl.createEl("h3", {
						text: run.group.label,
						cls: "qa-onepage-section",
					});
				}
				for (const req of run.fields) this.renderField(req);
			}
		} else {
			this.requirements.forEach((req) => this.renderField(req));
		}
		this.updateFieldVisibility(false);

		// AFTER the fields: `this.result` is populated inside renderField, so the
		// first pass used to run against an empty map and flash a stand-in
		// ("Example Title") over prefilled answers for 150ms.
		if (this.computePreview) void this.updatePreviews();

		const buttonBar = this.contentEl.createDiv({
			cls: "qa-prompt-actions",
		});
		const primary = buttonBar.createDiv({
			cls: "qa-prompt-actions-primary",
		});
		new ButtonComponent(primary)
			.setButtonText("Submit")
			.setCta()
			.onClick(() => this.submit());
		new ButtonComponent(primary)
			.setButtonText("Cancel")
			.onClick(() => this.cancel());
		const secondary = buttonBar.createDiv({
			cls: "qa-prompt-actions-secondary",
		});
		stylePeekButton(
			new ButtonComponent(secondary)
				.setButtonText("Peek at note")
				.onClick(() => this.peek.peek()),
		);
	}

	onOpen() {
		this.peek.onHostOpened();
		// Auto-focus the first field so keyboard-first users can start typing
		// immediately, matching the single-field prompts.
		const firstField = Array.from(this.contentEl.querySelectorAll<HTMLElement>(
			"input, textarea, select",
		)).find((element) => !element.closest("[hidden]"));
		firstField?.focus();

		// Mod+Enter submits without reaching for the mouse. Guarded because the
		// test mock's Modal has no scope.
		const scope = (
			this as unknown as {
				scope?: {
					register?: (
						mods: string[],
						key: string,
						cb: () => boolean,
					) => void;
				};
			}
		).scope;
		if (typeof scope?.register === "function") {
			scope.register(["Mod"], "Enter", () => {
				this.submit();
				return false;
			});
			scope.register(["Mod", "Shift"], PEEK_SHORTCUT_KEY, () => {
				this.peek.peek();
				return false;
			});
		}
	}

	private renderField(req: FieldRequirement) {
		const before = new Set(this.contentEl.children);
		const note = this.discoveryForm?.notes.find((field) => field.id === req.id);
		if (note) this.renderNoteField(note);
		else this.renderFieldControl(req);
		const elements = Array.from(this.contentEl.children)
			.filter((element): element is HTMLElement => element instanceof HTMLElement && !before.has(element));
		this.fieldElements.set(req.id, elements);
		if (!note) {
			this.controlFor(req).elements = elements;
			let anchor = this.fieldAnchors.get(req.id);
			if (!anchor) {
				anchor = this.contentEl.ownerDocument.createComment(req.id);
				this.contentEl.append(anchor);
				this.fieldAnchors.set(req.id, anchor);
			}
			for (const element of elements) this.contentEl.insertBefore(element, anchor);
		}
	}

	private controlFor(requirement: FieldRequirement): FieldControl {
		let control = this.fieldControls.get(requirement);
		if (!control) {
			control = { requirement, elements: [], value: "", dateParseError: false, suggesters: [], dispose: [] };
			this.fieldControls.set(requirement, control);
		}
		return control;
	}

	private publishControl(control: FieldControl): void {
		const req = control.requirement;
		if (this.settled || !this.requirements.includes(req)) return;
		this.result.set(req.id, control.value);
		if (control.multiSelections) this.multiSelections.set(req.id, control.multiSelections);
		else this.multiSelections.delete(req.id);
		if (control.fileSelections) this.fileSelections.set(req.id, control.fileSelections);
		else this.fileSelections.delete(req.id);
		if (control.dateParseError) this.dateParseErrors.add(req.id);
		else this.dateParseErrors.delete(req.id);
	}

	public get activeRequirements(): readonly FieldRequirement[] {
		return this.requirements.filter((req) => this.isFieldVisible(req.id));
	}

	private isFieldVisible(id: string): boolean {
		if (this.requirements.find((req) => req.id === id)?.runtimeOnly) return false;
		const conditions = this.discoveryForm?.visibleForNotes.get(id);
		return !conditions || conditions.some((condition) => acceptsDiscoverySelection(condition, this.discoverySelections));
	}

	private updateFieldVisibility(updatePreview = true): void {
		this.updateFieldMetadata();
		for (const [id, elements] of this.fieldElements) {
			for (const element of elements) element.hidden = !this.isFieldVisible(id);
		}
		for (const control of this.fieldControls.values()) {
			if (this.requirements.includes(control.requirement) && this.isFieldVisible(control.requirement.id)) continue;
			for (const suggester of control.suggesters) suggester.close();
		}
		for (const [requirement, input] of this.imagePasteInputs) {
			this.syncImagePaste(requirement, input);
		}
		if (updatePreview) this.updatePreviewDebounced();
	}

	private updateFieldMetadata(): void {
		for (let index = 0; index < this.requirements.length; index++) {
			let req = this.requirements[index];
			const usages = this.discoveryForm?.fieldUsages.get(req.id);
			if (!usages) continue;
			const resolved = resolveDiscoveryFieldRequirement(usages, this.discoverySelections);
			if (!resolved) continue;
			const next = { ...resolved, id: req.id, group: req.group };
			if (!this.fieldElements.has(req.id)) {
				this.requirements[index] = next;
				continue;
			}
			if (controlDefinition(req) !== controlDefinition(next)) {
				const previous = this.controlFor(req);
				previous.value = this.result.get(req.id) ?? previous.value;
				for (const suggester of previous.suggesters) suggester.close();
				for (const element of previous.elements) {
					element.hidden = true;
					element.remove();
				}
				const cached = Array.from(this.fieldControls.values()).find((control) =>
					control.requirement.id === req.id && controlDefinition(control.requirement) === controlDefinition(next));
				req = cached?.requirement ?? next;
				this.requirements[index] = req;
				if (cached) {
					for (const element of cached.elements) {
						this.contentEl.insertBefore(element, this.fieldAnchors.get(req.id) ?? null);
					}
					this.fieldElements.set(req.id, cached.elements);
					this.publishControl(cached);
				} else {
					this.renderField(req);
				}
			}
			Object.assign(req, { optional: next.optional, pathContext: next.pathContext, runtimeOnly: next.runtimeOnly });
			for (const element of this.fieldElements.get(req.id) ?? []) {
				element.querySelector(".setting-item-name")?.replaceChildren(this.decorateLabel(req));
				if (req.type !== "dropdown") continue;
				const select = element.querySelector("select");
				if (!select || req.options?.includes("")) continue;
				const skip = Array.from(select.options).find((option) => option.value === "");
				if (req.optional && !skip) {
					const option = select.ownerDocument.createElement("option");
					option.value = "";
					option.textContent = "Skip (leave empty)";
					select.prepend(option);
				} else if (!req.optional && skip) {
					skip.remove();
					const control = this.controlFor(req);
					control.value = select.value;
					this.publishControl(control);
				}
			}
		}
	}

	private renderNoteField(note: DiscoveryNoteField): void {
		const setting = new Setting(this.contentEl).setName("Note");
		setting.settingEl.addClass("qa-onepage-file-picker-setting");
		const container = setting.controlEl.createDiv({ cls: "qa-onepage-file-picker" });
		const selected = container.createDiv({ cls: "qa-onepage-file-picker__selection" });
		selected.setAttribute("aria-live", "polite");
		const input = new TextComponent(container).setPlaceholder("Search notes or create new note");
		input.inputEl.addClass("qa-onepage-file-picker__input");
		input.inputEl.setAttribute("aria-label", `Note for ${note.choice.name}`);
		let suggester: NoteDiscoveryInputSuggest | undefined;
		const showSelection = (selection: TemplateNoteSelection) => {
			suggester?.close();
			this.discoverySelections.set(note.id, selection);
			selected.empty();
			const action = existingNoteActionVerb(note.choice.existingNoteAction);
			const label = selection.kind === "existing"
				? `${action === "Open" ? "" : `${action}: `}${selection.path.replace(/\.md$/i, "")}`
				: `Create: ${selection.title}`;
			const chip = selected.createDiv({ cls: "qa-onepage-file-picker__chip" });
			chip.createSpan({ cls: "qa-onepage-file-picker__chip-label", text: label });
			const change = chip.createEl("button", { cls: "qa-onepage-file-picker__remove", text: "×" });
			change.type = "button";
			change.setAttribute("aria-label", "Change note");
			change.addEventListener("click", () => {
				this.discoverySelections.delete(note.id);
				selected.empty();
				input.inputEl.hidden = false;
				this.updateFieldVisibility();
				input.inputEl.focus();
			});
			input.inputEl.hidden = true;
			this.updateFieldVisibility();
			change.focus();
		};
		try {
			suggester = new NoteDiscoveryInputSuggest(this.app, input.inputEl, note.choice, showSelection, this.scope);
			this.discoverySuggesters.push(suggester);
		} catch {
			new Notice("Note search is unavailable. Type a new note title.");
		}
		this.discoveryInputs.set(note.id, {
			input: input.inputEl,
			select: showSelection,
			resolve: () => suggester
				? suggester.resolveInput(input.inputEl.value)
				: createTemplateNoteSelection(input.inputEl.value),
		});
	}

	private renderFieldControl(req: FieldRequirement): void {
		new OnePageFieldRenderer(this.app, this.contentEl, {
			controlFor: (requirement) => this.controlFor(requirement),
			initialValue: (id) => this.initialValues.get(id),
			publish: (control) => this.publishControl(control),
			updatePreview: () => this.updatePreviewDebounced(),
			decorateLabel: (requirement) => this.decorateLabel(requirement),
			attachFreeText: (requirement, input, setting) => {
				this.enableImagePaste(requirement, input);
				this.attachFreeTextBehaviors(requirement, input, setting);
			},
		}).render(req);
	}

	private attachFreeTextBehaviors(
		req: FieldRequirement,
		el: HTMLInputElement | HTMLTextAreaElement,
		setting: Setting,
	): void {
		const id = req.id;
		if (!setting.nameEl.id) {
			setting.nameEl.id = `qa-onepage-label-${id}`;
		}
		el.setAttribute("aria-labelledby", setting.nameEl.id);

		const field: OnePageFreeTextField = {
			id,
			el,
			fileSuggester: new FileSuggester(this.app, el),
			tagSuggester: new TagSuggester(this.app, el, {
				refreshIndex: this.freeTextFields.length === 0,
			}),
		};
		this.freeTextFields.push(field);
		this.controlFor(req).suggesters.push(field.fileSuggester, field.tagSuggester);
		el.addEventListener("focus", () => {
			this.lastFocusedFreeText = field;
		});
	}

	private insertTarget(): OnePageFreeTextField | undefined {
		if (this.lastFocusedFreeText && this.contentEl.contains(this.lastFocusedFreeText.el) && this.isFieldVisible(this.lastFocusedFreeText.id)) return this.lastFocusedFreeText;
		return this.freeTextFields.find((field) => this.contentEl.contains(field.el) && this.isFieldVisible(field.id));
	}

	/**
	 * Free-text fields accept clipboard-image paste UNLESS any scanned
	 * occurrence of the variable was path context (file name, folder, capture
	 * target, location target, template path) - an embed link would corrupt a
	 * path (issue #1484). The destination is unresolved at preflight time, so
	 * the saver runs with "" (vault-root placement and links that resolve
	 * from anywhere).
	 */
	private enableImagePaste(
		req: FieldRequirement,
		inputEl: HTMLInputElement | HTMLTextAreaElement,
	): void {
		this.imagePasteInputs.set(req, inputEl);
		this.syncImagePaste(req, inputEl);
	}

	private syncImagePaste(
		req: FieldRequirement,
		inputEl: HTMLInputElement | HTMLTextAreaElement,
	): void {
		const handle = this.imagePasteHandles.get(req);
		if (this.settled || req.pathContext || !this.requirements.includes(req) || !this.isFieldVisible(req.id)) {
			if (!this.settled && !req.pathContext && handle?.isBusy()) {
				void handle.whenIdle().then(() => this.syncImagePaste(req, inputEl));
				return;
			}
			handle?.detach();
			this.imagePasteHandles.delete(req);
		} else if (!handle) {
			this.imagePasteHandles.set(req, attachImagePasteHandler(this.app, inputEl, {}));
		}
	}

	private decorateLabel(req: FieldRequirement): string | DocumentFragment {
		if (!req.optional) return req.label;

		// Use the modal's own document (popout-aware) rather than the bare global.
		const doc = this.contentEl.ownerDocument;
		const fragment = doc.createDocumentFragment();
		fragment.appendChild(doc.createTextNode(req.label));
		const badge = doc.createElement("span");
		badge.textContent = " (optional)";
		badge.className = "qa-onepage-optional-badge";
		fragment.appendChild(badge);
		return fragment;
	}

	private submit() {
		if (this.settled) return;
		const previouslyHidden = new Set(this.requirements
			.filter((req) => !this.isFieldVisible(req.id)).map((req) => req.id));
		for (const note of this.discoveryForm?.notes ?? []) {
			if (this.discoverySelections.has(note.id)) continue;
			const field = this.discoveryInputs.get(note.id);
			if (!field) continue;
			if (!field.input.value.trim()) {
				new Notice("Enter a note title or choose an existing note.");
				field.input.focus();
				return;
			}
			try {
				field.select(field.resolve());
			} catch (error) {
				new Notice(error instanceof Error ? error.message : "Could not select this note.");
				field.input.focus();
				return;
			}
		}
		const revealed = this.requirements.find((req) => previouslyHidden.has(req.id) && this.isFieldVisible(req.id) &&
			!req.optional && !(this.result.get(req.id) ?? this.initialValues.get(req.id) ?? req.defaultValue));
		if (revealed) {
			this.fieldElements.get(revealed.id)?.[0]?.querySelector<HTMLElement>("input, textarea, select")?.focus();
			return;
		}
		// A pasted image may still be saving in one of the fields; defer so
		// paste-then-Mod+Enter submits WITH the embed link.
		const busyHandle = Array.from(this.imagePasteHandles.values()).find((handle) =>
			handle.isBusy(),
		);
		if (busyHandle) {
			void busyHandle.whenIdle().then(() => this.submit());
			return;
		}
		const out: Record<string, string> = {};

		// A required date whose typed text failed to parse must not slip through:
		// without a parse error the value would be silently dropped (and the
		// script path has no sequential re-prompt to recover it). Block Submit and
		// point the user at the offending field instead.
		const erroredDate = this.requirements.find(
			(req) =>
				this.isFieldVisible(req.id) &&
				req.type === "date" &&
				!req.optional &&
				this.dateParseErrors.has(req.id),
		);
		if (erroredDate) {
			new Notice(
				`QuickAdd: "${erroredDate.label}" is not a valid date. Fix it or clear it before submitting.`,
			);
			return;
		}

		// Reconcile the per-pick multi-select arrays against the final text: if the
		// user manually edited the field after picking (so the recorded picks no
		// longer reproduce the text), drop the array and let the consumer fall back
		// to text parsing. Otherwise the unambiguous picked order is authoritative.
		for (const [id, picks] of this.multiSelections) {
			const text = (this.result.get(id) ?? "").replace(/,\s*$/, "").trim();
			if (picks.join(", ") !== text) this.multiSelections.delete(id);
		}

		Object.assign(out, this.collectAnswers());
		this.settled = true;
		this.close();
		this.resolvePromise(out);
	}

	/**
	 * The answers as the consumer will actually receive them.
	 *
	 * Shared by `submit()` and the live preview so the preview cannot render a
	 * value the submit path is about to withhold (#1590). The one rule that
	 * differs from a plain copy of `this.result`: an empty DATE field is only an
	 * answer when the token said `|optional`. A required blank date, or any date
	 * whose text failed to parse, is OMITTED so it stays unresolved and the
	 * sequential date prompt - with its picker and aliases - still fires.
	 *
	 * Deriving that in the preflight instead would only get half of it: the
	 * parse-error set lives here, on the modal.
	 */
	private collectAnswers(): Record<string, string> {
		const requirementsById = new Map(
			this.requirements.map((req) => [req.id, req] as const),
		);
		const out: Record<string, string> = {};
		this.result.forEach((v, k) => {
			if (!this.isFieldVisible(k)) return;
			const requirement = requirementsById.get(k);
			if (requirement?.type === "date" && v === "") {
				const hasParseError = this.dateParseErrors.has(k);
				if (!requirement.optional || hasParseError) return;
			}

			// Store the field value verbatim. A textarea value used to be
			// backslash-doubled here; nothing downstream un-doubled it (the formatter
			// substitutes a {{VALUE}} verbatim and never linebreak-processes it), so
			// the doubling corrupted paths/regex/code — and compounded with the
			// |type:text YAML quoter, which escapes backslashes again. Keep it literal,
			// matching the wide and single-line prompts.
			out[k] = v;
		});
		return out;
	}

	private collectPreviewAnswers(): Record<string, unknown> {
		const out: Record<string, unknown> = this.collectAnswers();
		const requirementsById = new Map(
			this.requirements.map((req) => [req.id, req] as const),
		);
		for (const [id, picks] of this.fileSelections) {
			if (!this.isFieldVisible(id)) continue;
			out[id] = requirementsById.get(id)?.suggesterConfig?.multiSelect
				? [...picks]
				: (picks[0] ?? "");
		}
		return out;
	}

	private cancel() {
		this.settled = true;
		this.close();
		this.rejectPromise(promptCancelled());
	}

	onClose() {
		this.peek.onHostClosed();
		for (const handle of this.imagePasteHandles.values()) handle.detach();
		this.imagePasteHandles.clear();
		this.imagePasteInputs.clear();
		for (const control of this.fieldControls.values()) {
			for (const suggester of control.suggesters) suggester.destroy();
			for (const dispose of control.dispose) dispose();
		}
		this.freeTextFields.length = 0;
		this.lastFocusedFreeText = undefined;
		for (const suggester of this.discoverySuggesters) suggester.destroy();
		this.discoverySuggesters.length = 0;
		// Esc (or any close that isn't submit/cancel) must settle the promise,
		// otherwise the choice execution hangs forever on waitForClose.
		if (!this.settled) {
			this.settled = true;
			this.rejectPromise(promptCancelled());
		}
	}

	private async updatePreviews() {
		if (!this.computePreview || !this.previewContainerEl) return;
		// Debouncing orders starts, not completions. Commit only the latest pass.
		const token = ++this.previewToken;
		try {
			// The same answers submit() will hand over, so the row never previews a
			// value the run is about to re-ask for: an untouched required
			// {{VDATE:}} is withheld here too, and the preview falls back to its
			// example date instead of rendering an empty one (#1590).
			const rows = await this.computePreview(this.collectPreviewAnswers());
			if (token !== this.previewToken || !this.previewContainerEl) return;

			renderOnePagePreview(this.previewContainerEl, rows);
		} catch {
			// Ignore preview errors
		}
	}
}
