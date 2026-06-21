import type { App, DropdownComponent, TextComponent } from "obsidian";
import { ButtonComponent, Modal, Notice, Setting } from "obsidian";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import type {
	ConditionalCondition,
	ScriptCondition,
	VariableCondition,
} from "../../types/macros/Conditional/types";
import {
	getConditionSummary,
	getDefaultValueTypeForOperator,
	requiresExpectedValue,
} from "../../utils/conditionalHelpers";
import InputSuggester from "../InputSuggester/inputSuggester";
import { showNoScriptsFoundNotice } from "./noScriptsFoundNotice";
import {
	type ScriptCandidate,
	loadScriptCandidates,
	noteScriptError,
} from "./scriptCandidates";

function cloneCondition(condition: ConditionalCondition): ConditionalCondition {
	return condition.mode === "variable"
		? { ...condition }
		: { ...condition };
}

function createDefaultVariableCondition(): VariableCondition {
	return {
		mode: "variable",
		variableName: "",
		operator: "isTruthy",
		valueType: "boolean",
	};
}

function createDefaultScriptCondition(): ScriptCondition {
	return {
		mode: "script",
		scriptPath: "",
	};
}

export class ConditionalCommandSettingsModal extends Modal {
	public waitForClose: Promise<IConditionalCommand | null>;
	private resolvePromise!: (command: IConditionalCommand | null) => void;
	private readonly originalCommand: IConditionalCommand;
	private workingCommand: IConditionalCommand;
	private isResolved = false;
	private scriptCandidates: ScriptCandidate[] = [];

	constructor(app: App, command: IConditionalCommand) {
		super(app);
		this.originalCommand = command;
		this.workingCommand = {
			...command,
			condition: cloneCondition(command.condition),
		};

		this.waitForClose = new Promise<IConditionalCommand | null>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.loadScriptCandidates();
		this.display();
		this.open();
	}

	onClose() {
		super.onClose();
		if (!this.isResolved) {
			this.resolve(null);
		}
	}

	private resolve(value: IConditionalCommand | null) {
		if (this.isResolved) return;
		this.isResolved = true;
		this.resolvePromise(value);
	}

	private loadScriptCandidates() {
		this.scriptCandidates = loadScriptCandidates(this.app);
	}

	private reload() {
		this.display();
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "conditionalSettingsModal");
		this.contentEl.empty();

		const headerEl = this.contentEl.createEl("h2", {
			text: "Configure Conditional Command",
		});
		headerEl.addClass("qa-modal-title");

		this.renderModeSelector();
		if (this.workingCommand.condition.mode === "variable") {
			this.renderVariableConfiguration(this.workingCommand.condition);
		} else {
			this.renderScriptConfiguration(this.workingCommand.condition);
		}

		this.renderButtonBar();
	}

	private renderModeSelector() {
		new Setting(this.contentEl)
			.setName("Condition type")
			.setDesc("Choose how this condition should be evaluated.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("variable", "Macro variable")
					.addOption("script", "Run script")
					.setValue(this.workingCommand.condition.mode)
					.onChange((value) => {
						if (value === this.workingCommand.condition.mode) return;
						this.workingCommand.condition =
							value === "variable"
								? createDefaultVariableCondition()
								: createDefaultScriptCondition();
						this.reload();
					});
			});
	}

	private renderVariableConfiguration(condition: VariableCondition) {
		this.renderVariableNameSetting(condition);
		this.renderOperatorSetting(condition);
		this.renderValueTypeSetting(condition);
		if (requiresExpectedValue(condition.operator)) {
			this.renderExpectedValueSetting(condition);
		}
	}

	private renderVariableNameSetting(condition: VariableCondition) {
		new Setting(this.contentEl)
			.setName("Variable name")
			.setDesc("Name of the macro variable to inspect (without the $ prefix).")
			.addText((text) =>
				text
					.setPlaceholder("e.g. projectStatus")
					.setValue(condition.variableName)
					.onChange((value) => {
						condition.variableName = value.trim();
					})
			);
	}

	private renderOperatorSetting(condition: VariableCondition) {
		const operators: Array<{ value: VariableCondition["operator"]; label: string }> = [
			{ value: "equals", label: "Equals" },
			{ value: "notEquals", label: "Does not equal" },
			{ value: "lessThan", label: "Less than" },
			{ value: "lessThanOrEqual", label: "Less than or equal" },
			{ value: "greaterThan", label: "Greater than" },
			{ value: "greaterThanOrEqual", label: "Greater than or equal" },
			{ value: "contains", label: "Contains" },
			{ value: "notContains", label: "Does not contain" },
			{ value: "isTruthy", label: "Is truthy" },
			{ value: "isFalsy", label: "Is falsy" },
		];

		new Setting(this.contentEl)
			.setName("Operator")
			.setDesc("How to compare the variable value.")
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOptions(
					operators.reduce<Record<string, string>>((acc, option) => {
						acc[option.value] = option.label;
						return acc;
					}, {})
				);
				dropdown.setValue(condition.operator);
				dropdown.onChange((value) => {
					condition.operator = value as VariableCondition["operator"];
					condition.valueType = getDefaultValueTypeForOperator(
						condition.operator
					);
					if (!requiresExpectedValue(condition.operator)) {
						delete condition.expectedValue;
					}
					this.reload();
				});
			});
	}

	private renderValueTypeSetting(condition: VariableCondition) {
		new Setting(this.contentEl)
			.setName("Value type")
			.setDesc("How to interpret the comparison value.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("string", "Text")
					.addOption("number", "Number")
					.addOption("boolean", "Boolean")
					.setValue(condition.valueType)
					.onChange((value) => {
						condition.valueType = value as VariableCondition["valueType"];
						this.reload();
					});
			});
	}

	private renderExpectedValueSetting(condition: VariableCondition) {
		if (condition.valueType === "boolean") {
			new Setting(this.contentEl)
				.setName("Expected value")
				.setDesc("Choose true or false.")
				.addDropdown((dropdown) => {
					dropdown
						.addOption("true", "True")
						.addOption("false", "False")
						.setValue(condition.expectedValue ?? "true")
						.onChange((value) => {
							condition.expectedValue = value;
						});
				});
			return;
		}

		new Setting(this.contentEl)
			.setName("Expected value")
			.setDesc("Value to compare against.")
			.addText((text: TextComponent) => {
				text
					.setPlaceholder("Enter comparison value")
					.setValue(condition.expectedValue ?? "")
					.onChange((value) => {
						condition.expectedValue = value;
					});
			});
	}

	private renderScriptConfiguration(condition: ScriptCondition) {
		this.renderScriptPathSetting(condition);
		this.renderScriptExportSetting(condition);
	}

	private renderScriptPathSetting(condition: ScriptCondition) {
		let input: TextComponent;

		new Setting(this.contentEl)
			.setName("Script path")
			.setDesc("Vault-relative path to a .js file or a note with a ```js code block.")
			.addText((text) => {
				input = text;
				text
					.setPlaceholder("scripts/myCheck.js or Notes/myCheck.md")
					.setValue(condition.scriptPath)
					.onChange((value) => {
						condition.scriptPath = value.trim();
					});
			})
			.addButton((button) =>
				button
					.setButtonText("Browse")
					.setTooltip("Select a script (.js file or note)")
					.onClick(async () => {
						// Refresh so notes/scripts created while this modal is open appear.
						this.loadScriptCandidates();
						if (this.scriptCandidates.length === 0) {
							showNoScriptsFoundNotice(this.app);
							return;
						}

						// This picker stores condition.scriptPath, so show full paths for
						// every entry (a vault can have several same-basename scripts).
						const paths = this.scriptCandidates.map((c) => c.file.path);
						const selected = await InputSuggester.Suggest(
							this.app,
							paths,
							paths,
							{
								placeholder:
									"Select a script (.js file or note with a ```js block)",
								emptyStateText: "No scripts found in your vault",
							}
						);

						if (!selected) return;

						const candidate = this.scriptCandidates.find(
							(c) => c.file.path === selected
						);
						if (candidate?.isMarkdown) {
							const reason = await noteScriptError(
								this.app,
								candidate.file
							);
							if (reason) {
								new Notice(
									`QuickAdd: "${candidate.file.path}" — ${reason}`,
								);
								return;
							}
						}

						condition.scriptPath = selected;
						input.setValue(selected);
					})
			);
	}

	private renderScriptExportSetting(condition: ScriptCondition) {
		new Setting(this.contentEl)
			.setName("Export name")
			.setDesc("Optional export or member to call (use :: to access nested members).")
			.addText((text) =>
				text
					.setPlaceholder("default")
					.setValue(condition.exportName ?? "")
					.onChange((value) => {
						condition.exportName = value.trim() || undefined;
					})
			);
	}

	private renderButtonBar() {
		const buttonContainer = this.contentEl.createDiv({
			cls: "qa-command-button-row",
		});

		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => {
				this.resolve(null);
				this.close();
			});

		new ButtonComponent(buttonContainer)
			.setCta()
			.setButtonText("Save")
			.onClick(() => {
				if (!this.validateCondition()) return;
				this.applyChanges();
				this.resolve(this.originalCommand);
				this.close();
			});
	}

	private validateCondition(): boolean {
		const condition = this.workingCommand.condition;
		if (condition.mode === "variable") {
			if (!condition.variableName.trim()) {
				new Notice("QuickAdd: Enter a variable name before saving.");
				return false;
			}
			return true;
		}

		if (!condition.scriptPath.trim()) {
			new Notice("QuickAdd: Enter a script path before saving.");
			return false;
		}
		return true;
	}

	private applyChanges() {
		this.originalCommand.condition = cloneCondition(
			this.workingCommand.condition
		);
		const summary = getConditionSummary(this.originalCommand.condition);
		this.originalCommand.name = `If ${summary}`;
	}
}
