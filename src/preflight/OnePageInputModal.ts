import {
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Setting,
	TextAreaComponent,
	TextComponent,
	debounce,
	type App,
} from "obsidian";
import { FIELD_VARIABLE_PREFIX } from "src/constants";
import { createDatePicker } from "src/gui/date-picker/datePicker";
import { InputPromptPeek } from "src/gui/promptPeek/InputPromptPeek";
import {
	applyCompactPromptChrome,
	stylePeekButton,
} from "src/gui/promptPeek/stylePeekButton";
import { PEEK_SHORTCUT_KEY } from "src/gui/promptShortcuts";
import { FieldValueInputSuggest } from "src/gui/suggesters/FieldValueInputSuggest";
import {
	FilePickerInputSuggest,
	type FilePickerOption,
} from "src/gui/suggesters/FilePickerInputSuggest";
import { FileSuggester } from "src/gui/suggesters/fileSuggester";
import { SuggesterInputSuggest } from "src/gui/suggesters/SuggesterInputSuggest";
import { TagSuggester } from "src/gui/suggesters/tagSuggester";
import { formatISODate, parseNaturalLanguageDate } from "src/utils/dateParser";
import {
	formatDateAliasInline,
	getOrderedDateAliases,
} from "src/utils/dateAliases";
import { settingsStore } from "src/settingsStore";
import type { FieldGroup, FieldRequirement } from "./RequirementCollector";
import type { ImagePasteHandle } from "src/gui/imagePasteHandler";
import { attachImagePasteHandler } from "src/gui/imagePasteHandler";
import {
	mapMappedSuggesterValue,
	resolveDropdownInitialValue,
} from "./suggesterValueMapping";
import {
	normalizeNumericValue,
	normalizeSliderValue,
} from "src/utils/valueSyntax";
import { promptCancelled } from "../errors/UserCancelError";
import type { PreviewDiagnostic } from "src/formatters/previewDiagnostics";
import { decodeFileValue } from "src/utils/fileSyntax";
import { NoteDiscoveryInputSuggest } from "src/gui/suggesters/NoteDiscoveryInputSuggest";
import { createTemplateNoteSelection, type TemplateNoteSelection } from "src/utils/templateNoteDiscovery";
import { acceptsDiscoverySelection, resolveDiscoveryFieldRequirement, type DiscoveryFormConfig, type DiscoveryNoteField } from "./discoveryFormPlan";
import { existingNoteActionVerb } from "src/template/fileExistsPolicy";

type CompletionInputEvent = Event & {
	fromCompletion?: boolean;
};

type OnePageFreeTextField = {
	id: string;
	el: HTMLInputElement | HTMLTextAreaElement;
	fileSuggester: FileSuggester;
	tagSuggester: TagSuggester;
};

/**
 * One row of the live preview block, with the problems that pass ran into.
 *
 * An ordered list, not a keyed record: the row needs a display LABEL, and the
 * record's raw key was being rendered - so the file-name row read `fileName:`
 * (#1590). `diagnostics` is the channel the builder's row has had since #1558
 * and this one silently dropped, which is how a name Obsidian refuses could be
 * presented here in ordinary styling with nothing said.
 */
export type PreviewRow = {
	label: string;
	text: string;
	diagnostics: readonly PreviewDiagnostic[];
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

interface FieldControl {
	requirement: FieldRequirement;
	elements: HTMLElement[];
	value: string;
	multiSelections?: string[];
	fileSelections?: string[];
	dateParseError: boolean;
	suggesters: Array<{ close(): void; destroy(): void }>;
	dispose: Array<() => void>;
}

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

	private renderFieldControl(req: FieldRequirement) {
		const control = this.controlFor(req);
		const setValue = (_id: string, value: string) => {
			control.value = value;
			this.publishControl(control);
			this.updatePreviewDebounced();
		};
		const starting = this.initialValues.get(req.id) ?? req.defaultValue ?? "";
		control.value = starting;

		switch (req.type) {
			case "textarea": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const input = new TextAreaComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				input.inputEl.addClass("qa-onepage-textarea");
				this.enableImagePaste(req, input.inputEl);
				this.attachFreeTextBehaviors(req, input.inputEl, setting);
				break;
			}
			case "text": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				this.enableImagePaste(req, input.inputEl);
				this.attachFreeTextBehaviors(req, input.inputEl, setting);
				break;
			}
			case "number": {
				// |type:number — a numeric input so the one-page form rejects
				// non-numeric text like the runtime NumberInputPrompt does.
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const input = new TextComponent(setting.controlEl);
				input.inputEl.type = "number";
				input.inputEl.inputMode = "decimal";
				if (req.numericConfig?.min !== undefined) {
					input.inputEl.min = String(req.numericConfig.min);
				}
				if (req.numericConfig?.max !== undefined) {
					input.inputEl.max = String(req.numericConfig.max);
				}
				input.inputEl.step =
					req.numericConfig?.step !== undefined
						? String(req.numericConfig.step)
						: "any";
				const normalizedStarting = req.numericConfig
					? normalizeNumericValue(starting, req.numericConfig)
					: starting;
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(normalizedStarting)
					.onChange((v) =>
						setValue(
							req.id,
							req.numericConfig ? normalizeNumericValue(v, req.numericConfig) : v,
						),
					);
				setValue(req.id, normalizedStarting);
				break;
			}
			case "slider": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				setting.controlEl.parentElement?.addClass(
					"qa-onepage-slider-setting",
				);
				if (req.description) setting.setDesc(req.description);
				const sliderConfig = req.sliderConfig ?? { min: 0, max: 100, step: 1 };
				const isOptionalBlank = req.optional && starting === "";
				const initial = normalizeSliderValue(starting, sliderConfig);
				const container = setting.controlEl.createDiv({
					cls: "qa-onepage-slider",
				});
				const range = container.createEl("input");
				range.type = "range";
				range.min = String(sliderConfig.min);
				range.max = String(sliderConfig.max);
				range.step = String(sliderConfig.step);
				range.value = initial;
				const input = new TextComponent(container);
				input.inputEl.type = "number";
				input.inputEl.inputMode = "decimal";
				input.inputEl.min = String(sliderConfig.min);
				input.inputEl.max = String(sliderConfig.max);
				input.inputEl.step = String(sliderConfig.step);
				input.setValue(isOptionalBlank ? "" : initial);
				setValue(req.id, isOptionalBlank ? "" : initial);

				range.addEventListener("input", () => {
					input.inputEl.value = range.value;
					setValue(req.id, range.value);
				});
				input.onChange((value) => {
					if (value === "" && req.optional) {
						setValue(req.id, "");
						return;
					}
					const normalized = normalizeNumericValue(value, sliderConfig);
					if (normalized === "") return;
					range.value = normalized;
					input.inputEl.value = normalized;
					setValue(req.id, normalized);
				});
				break;
			}
			case "dropdown": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const dropdown = new DropdownComponent(setting.controlEl);
				const options = req.options ?? [];
				const displayOptions = req.displayOptions ?? options;
				if (options.length > 0) {
					// Optional dropdowns offer an explicit skip entry, but the
					// first real option stays preselected: adding |optional must
					// not silently change what an untouched submit yields.
					if (req.optional) {
						dropdown.addOption("", "Skip (leave empty)");
					}
					options.forEach((opt, index) => {
						const display = displayOptions[index] ?? opt;
						dropdown.addOption(opt, display);
					});
					const selectedValue = resolveDropdownInitialValue(starting, options);
					dropdown.setValue(selectedValue);
					setValue(req.id, selectedValue);
					dropdown.onChange((v) => setValue(req.id, v));
				} else {
					dropdown.setDisabled(true);
					const note = setting.controlEl.createDiv({
						text: req.placeholder || "No options available",
					});
					note.addClass("qa-onepage-dropdown-note");
				}
				break;
			}
			case "date": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				// The input, calendar, and parsed preview do not fit beside the
				// label the way a lone text box does, so this row stacks.
				setting.settingEl.addClass("qa-onepage-date-setting");
				if (req.description) setting.setDesc(req.description);
				const container = setting.controlEl.createDiv({
					cls: "qa-date-input",
				});
				const input = new TextComponent(container);
				const placeholder =
					"Enter a date (e.g., 'today', 'next friday', '2025-12-25')";

				let selectedIso: string | undefined;
				let displayValue = starting;
				if (starting?.startsWith("@date:")) {
					selectedIso = starting.slice(6);
					const formatted = req.dateFormat
						? formatISODate(selectedIso, req.dateFormat)
						: undefined;
					displayValue =
						formatted ??
						(selectedIso.length >= 10 ? selectedIso.slice(0, 10) : selectedIso);
				}

				input.setPlaceholder(placeholder).setValue(displayValue ?? "");

				const preview = container.createDiv();
				preview.addClass("qa-date-preview-text");

				const pickerContainer = container.createDiv({
					cls: "qa-date-picker-container",
				});
				const datePicker = createDatePicker({
					container: pickerContainer,
					initialIso: selectedIso,
					withTime: req.withTime === true,
					onSelect: (iso) => {
						if (iso) applyPickerSelection(iso);
						else clearPickerSelection();
					},
				});

				control.dispose.push(() => datePicker.destroy());

				const aliasEntries = getOrderedDateAliases(
					settingsStore.getState().dateAliases,
				);
				if (aliasEntries.length > 0) {
					const aliasDetails = container.createEl("details");
					aliasDetails.addClass("qa-date-alias-details");

					const aliasSummary = aliasDetails.createEl("summary", {
						text: `Aliases (${aliasEntries.length})`,
					});
					aliasSummary.addClass("qa-date-alias-summary");

					const aliasList = aliasDetails.createEl("div");
					aliasList.textContent = formatDateAliasInline(
						settingsStore.getState().dateAliases,
					);
					aliasList.addClass("qa-date-alias-list");
				}

				const formatIsoForDisplay = (iso: string) => {
					if (req.dateFormat) {
						const formatted = formatISODate(iso, req.dateFormat);
						if (formatted) return formatted;
					}
					return iso.length >= 10 ? iso.slice(0, 10) : iso;
				};

				const renderPreview = (text: string, isError: boolean) => {
					preview.setText(text);
					preview.toggleClass("is-error", isError);
				};

				const syncSelection = (iso?: string) => {
					datePicker.setSelectedIso(iso);
				};

				const applyPickerSelection = (iso: string) => {
					selectedIso = iso;
					control.dateParseError = false;
					const display = formatIsoForDisplay(iso);
					input.inputEl.value = display;
					setValue(req.id, `@date:${iso}`);
					renderPreview(display, false);
					syncSelection(iso);
				};

				const clearPickerSelection = () => {
					input.inputEl.value = "";
					updatePreview("");
				};

				const updatePreview = (val: string) => {
					const inputVal = (val ?? "").trim();
					// A blank optional date means "leave empty" — never
					// resurrect the default the user just cleared.
					if (!inputVal && req.defaultValue && !req.optional) {
						const parsed = parseNaturalLanguageDate(
							req.defaultValue,
							req.dateFormat,
						);
						if (parsed.isValid && parsed.isoString) {
							selectedIso = parsed.isoString;
							control.dateParseError = false;
							setValue(req.id, `@date:${parsed.isoString}`);
							syncSelection(parsed.isoString);
							const formatted =
								parsed.formatted ??
								formatIsoForDisplay(parsed.isoString);
							renderPreview(formatted, false);
							return;
						}
						renderPreview(parsed.error || "Unable to parse date", true);
						control.dateParseError = true;
						setValue(req.id, "");
						syncSelection();
						return;
					}
					if (!inputVal) {
						selectedIso = undefined;
						control.dateParseError = false;
						setValue(req.id, "");
						syncSelection();
						renderPreview(
							req.optional
								? "Will be left empty"
								: "Preview will appear here",
							false,
						);
						return;
					}

					if (inputVal.startsWith("@date:")) {
						const iso = inputVal.slice(6).trim();
						if (iso) {
							control.dateParseError = false;
							applyPickerSelection(iso);
							return;
						}
					}

					const parsed = parseNaturalLanguageDate(inputVal, req.dateFormat);
					if (parsed.isValid && parsed.isoString) {
						selectedIso = parsed.isoString;
						control.dateParseError = false;
						setValue(req.id, `@date:${parsed.isoString}`);
						syncSelection(parsed.isoString);
						const formatted =
							parsed.formatted ?? formatIsoForDisplay(parsed.isoString);
						renderPreview(formatted, false);
					} else {
						selectedIso = undefined;
						control.dateParseError = true;
						setValue(req.id, "");
						syncSelection();
						renderPreview(parsed.error || "Unable to parse date", true);
					}
				};

				input.onChange((v) => updatePreview(v));

				if (selectedIso) {
					applyPickerSelection(selectedIso);
				} else {
					updatePreview(displayValue ?? "");
				}
				break;
			}
			case "field-suggest": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				// Attach inline suggester powered by vault data & filters encoded in
				// req.id. Collected FIELD requirements are keyed "FIELD:<specifier>";
				// strip the prefix so the suggester parses the bare field specifier.
				const fieldSpecifier = req.id.startsWith(FIELD_VARIABLE_PREFIX)
					? req.id.slice(FIELD_VARIABLE_PREFIX.length)
					: req.id;
				try {
					control.suggesters.push(new FieldValueInputSuggest(this.app, input.inputEl, fieldSpecifier));
				} catch {
					// Non-fatal; leave as plain input if suggester fails
				}
				break;
			}
			case "suggester": {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				if (req.description) setting.setDesc(req.description);
				const options = req.options ?? [];
				const displayOptions = req.displayOptions ?? options;
				const displayToValue = new Map<string, string>();
				const valueToDisplay = new Map<string, string>();
				options.forEach((value, index) => {
					const display = displayOptions[index] ?? value;
					displayToValue.set(display, value);
					if (!valueToDisplay.has(value)) {
						valueToDisplay.set(value, display);
					}
				});
				const startingDisplay = valueToDisplay.get(starting) ?? starting;
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "Type to search...")
					.setValue(startingDisplay)
					.onChange((v) => setValue(req.id, v));
				input.inputEl.addEventListener("input", (event) => {
					const fromCompletion = Boolean(
						(event as CompletionInputEvent).fromCompletion,
					);
					const rawInput = input.inputEl.value;
					const storedValue = mapMappedSuggesterValue(
						rawInput,
						displayToValue,
						fromCompletion,
					);
					if (storedValue !== rawInput || fromCompletion) {
						setValue(req.id, storedValue);
					}
				});
				// Attach suggester if options are provided
				if (displayOptions.length > 0) {
					try {
						const caseSensitive = req.suggesterConfig?.caseSensitive ?? false;
						const multiSelect = req.suggesterConfig?.multiSelect ?? false;
						control.suggesters.push(new SuggesterInputSuggest(
							this.app,
							input.inputEl,
							displayOptions,
							caseSensitive,
							multiSelect,
							multiSelect
								? (item) => {
										const arr = control.multiSelections ?? [];
										arr.push(item);
										control.multiSelections = arr;
										this.publishControl(control);
									}
								: undefined,
						));
					} catch {
						// Non-fatal; falls back to plain text input
					}
				}
				break;
			}
			case "file-picker": {
				this.renderFilePickerField(req, starting, setValue);
				break;
			}
			default: {
				const setting = new Setting(this.contentEl).setName(
					this.decorateLabel(req),
				);
				const input = new TextComponent(setting.controlEl);
				input
					.setPlaceholder(req.placeholder ?? "")
					.setValue(starting)
					.onChange((v) => setValue(req.id, v));
				this.enableImagePaste(req, input.inputEl);
				this.attachFreeTextBehaviors(req, input.inputEl, setting);
			}
		}

		// Initialize stored value for empty inputs to ensure presence
		this.publishControl(control);
	}

	private renderFilePickerField(
		req: FieldRequirement,
		starting: string,
		setValue: (id: string, value: string) => void,
	): void {
		const setting = new Setting(this.contentEl).setName(
			this.decorateLabel(req),
		);
		setting.settingEl.addClass("qa-onepage-file-picker-setting");
		if (req.description) setting.setDesc(req.description);

		const values = req.options ?? [];
		const displayValues = req.displayOptions ?? values;
		const options: FilePickerOption[] = values.map((value, index) => {
			const decoded = decodeFileValue(value);
			return {
				value,
				label: displayValues[index] ?? value,
				path: decoded.kind === "file" ? decoded.path : value,
			};
		});
		const optionByValue = new Map(options.map((option) => [option.value, option]));
		const multiSelect = req.suggesterConfig?.multiSelect ?? false;
		const allowCustomInput =
			req.suggesterConfig?.allowCustomInput ?? false;
		const selected = new Set<string>();
		const customOptions = new Map<string, FilePickerOption>();

		const addCustomOption = (value: string): FilePickerOption => {
			const existing = customOptions.get(value);
			if (existing) return existing;
			const option = {
				value,
				label: value,
				path: "Custom value",
				isCustom: true,
			};
			customOptions.set(value, option);
			return option;
		};

		if (starting && optionByValue.has(starting)) {
			selected.add(starting);
		} else if (starting && allowCustomInput) {
			const decoded = decodeFileValue(starting);
			const customValue =
				decoded.kind === "custom" ? decoded.text : starting;
			addCustomOption(customValue);
			selected.add(customValue);
		} else if (!multiSelect && options.length > 0) {
			// Preserve the former dropdown's untouched-submit behavior. The first
			// file stays selected by default, but is now visible and removable.
			selected.add(options[0].value);
		}

		const container = setting.controlEl.createDiv({
			cls: "qa-onepage-file-picker",
		});
		const selectionEl = container.createDiv({
			cls: "qa-onepage-file-picker__selection",
		});
		selectionEl.setAttribute("aria-live", "polite");
		const input = new TextComponent(container);
		input.inputEl.addClass("qa-onepage-file-picker__input");
		input.setPlaceholder(
			req.placeholder ??
				(multiSelect ? "Search and add files..." : "Search files..."),
		);
		input.inputEl.setAttribute(
			"aria-label",
			multiSelect ? `Add files for ${req.label}` : `Choose file for ${req.label}`,
		);

		const orderedSelections = (): FilePickerOption[] => {
			const ordered = options.filter((option) => selected.has(option.value));
			for (const option of customOptions.values()) {
				if (selected.has(option.value)) ordered.push(option);
			}
			return ordered;
		};

		const sync = () => {
			const picked = orderedSelections();
			const pickedValues = picked.map((option) => option.value);
			this.controlFor(req).fileSelections = pickedValues;
			setValue(
				req.id,
				multiSelect ? pickedValues.join(", ") : (pickedValues[0] ?? ""),
			);

			selectionEl.empty();
			selectionEl.toggleClass("qa-hidden", picked.length === 0);
			for (const option of picked) {
				const chip = selectionEl.createDiv({
					cls: "qa-onepage-file-picker__chip",
				});
				chip.setAttribute("title", option.path);
				chip.createSpan({
					cls: "qa-onepage-file-picker__chip-label",
					text: option.label,
				});
				const remove = chip.createEl("button", {
					cls: "qa-onepage-file-picker__remove",
					text: "×",
				});
				remove.type = "button";
				remove.setAttribute("aria-label", `Remove ${option.label}`);
				remove.addEventListener("click", () => {
					selected.delete(option.value);
					sync();
					input.inputEl.focus();
				});
			}
		};

		const selectOption = (option: FilePickerOption) => {
			const selectedOption = option.isCustom
				? addCustomOption(option.value)
				: option;
			if (!multiSelect) selected.clear();
			selected.add(selectedOption.value);
			sync();
		};

		input.inputEl.addEventListener("keydown", (event) => {
			if (
				event.key === "Backspace" &&
				input.inputEl.value === "" &&
				selected.size > 0
			) {
				const last = orderedSelections().at(-1);
				if (!last) return;
				event.preventDefault();
				selected.delete(last.value);
				sync();
			}
		});

		try {
			const suggester = new FilePickerInputSuggest(
				this.app,
				input.inputEl,
				() => [...options, ...customOptions.values()],
				(value) => selected.has(value),
				selectOption,
				multiSelect,
				allowCustomInput,
			);
			this.controlFor(req).suggesters.push(suggester);
		} catch {
			// A failed suggester should not break the rest of the one-page form.
			input.setDisabled(true);
		}

		sync();
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
		// The builder's guard (FormatPreviewField), which this block never had:
		// the 150ms debounce orders the STARTS of these passes, not their
		// completions, and a pass can read up to 25 templates. Text and problems
		// have to commit together, or one pass's name stands beside another's
		// complaint.
		const token = ++this.previewToken;
		try {
			// The same answers submit() will hand over, so the row never previews a
			// value the run is about to re-ask for: an untouched required
			// {{VDATE:}} is withheld here too, and the preview falls back to its
			// example date instead of rendering an empty one (#1590).
			const rows = await this.computePreview(this.collectPreviewAnswers());
			if (token !== this.previewToken || !this.previewContainerEl) return;

			this.previewContainerEl.empty();
			// A choice with nothing to preview (every Capture, Macro and Multi, and
			// every Template using the default note-title prompt) rendered an empty
			// tinted box containing the single word "Preview". The container is
			// still created up front - its position between the title and the first
			// field is load-bearing, and an async append would land it under the
			// Submit row - so it collapses instead.
			this.previewContainerEl.toggleClass("qa-hidden", rows.length === 0);

			for (const row of rows) {
				const errors = row.diagnostics.filter((d) => d.severity === "error");
				// Same three-state vocabulary as the builder's row (#1594): a format
				// that could not RESOLVE is showing raw text back, while a name the
				// vault will refuse is an accurate preview of a note that will not
				// exist. Unresolved wins when both are present.
				const unresolved = errors.some((d) => d.kind !== "path");
				const label = unresolved
					? "Unresolved"
					: errors.length > 0
						? "Won't be created"
						: row.label;

				const rowEl = this.previewContainerEl.createDiv({
					cls: "qa-onepage-preview-row",
				});
				rowEl.createEl("div", { text: `${label}:`, cls: "qa-preview-key" });
				// Clamped in CSS, with the whole string on the element: this block
				// sits ABOVE every input and re-renders as you type, and since #1563
				// a file-name preview can be a whole included template joined onto
				// one line - unclamped it would push the fields and Submit down and
				// shift them under the caret.
				const valueEl = rowEl.createEl("div", {
					text: row.text,
					cls: "qa-preview-val",
				});
				valueEl.setAttribute("title", row.text);

				for (const diagnostic of row.diagnostics) {
					const issueEl = this.previewContainerEl.createDiv({
						cls: "qa-preview-issue",
					});
					issueEl.toggleClass(
						"qa-preview-issue--error",
						diagnostic.severity === "error",
					);
					// Severity in TEXT, not colour alone (WCAG 1.4.1), matching the
					// builder's row.
					issueEl.createSpan({
						cls: "qa-visually-hidden",
						text: diagnostic.severity === "error" ? "Error: " : "Warning: ",
					});
					issueEl.appendText(diagnostic.message);
					issueEl.setAttribute("title", diagnostic.message);
				}
			}
		} catch {
			// Ignore preview errors
		}
	}
}
