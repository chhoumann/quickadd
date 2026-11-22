import type {
	App,
	DropdownComponent,
	TextComponent,
} from "obsidian";
import { ButtonComponent, Notice, Setting } from "obsidian";
import CommandList from "./CommandList.svelte";
import { editorCommands } from "./editorCommands";
import type { CommandListProps } from "./commandListProps";
import { reactiveProps } from "../svelte/reactiveProps.svelte";
import { mountComponent, type MountHandle } from "../svelte/mountComponent";
import type { ChoiceBuilderPlugin } from "../../types/pluginContext";
import type { ICommand } from "../../types/macros/ICommand";
import type IChoice from "../../types/choices/IChoice";
import { ObsidianCommand } from "../../types/macros/ObsidianCommand";
import type { IObsidianCommand } from "../../types/macros/IObsidianCommand";
import { ChoiceCommand } from "../../types/macros/ChoiceCommand";
import { WaitCommand } from "../../types/macros/QuickCommands/WaitCommand";
import { NestedChoiceCommand } from "../../types/macros/QuickCommands/NestedChoiceCommand";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import {
	type ScriptCandidate,
	candidateLabels,
	loadScriptCandidates,
	noteScriptError,
	resolveScriptSelector,
} from "./scriptCandidates";
import { UserScript } from "../../types/macros/UserScript";
import { GenericTextSuggester } from "../suggesters/genericTextSuggester";
import { confirmAction } from "../confirmAction";
import { showNoScriptsFoundNotice } from "./noScriptsFoundNotice";
import InputSuggester from "../InputSuggester/inputSuggester";
import { renderNotePathSuggestion } from "../InputSuggester/renderNotePathSuggestion";
import { buildFileDisplayInfos } from "../../utils/fileSyntax";
import { log } from "../../logger/logManager";
import { reportingHandler } from "../../utils/errorUtils";
import { AIAssistantCommand } from "../../types/macros/QuickCommands/AIAssistantCommand";
import { settingsStore } from "../../settingsStore";
import { activeModelRef } from "../../ai/Provider";
import { OpenFileCommand } from "../../types/macros/QuickCommands/OpenFileCommand";
import type { IConditionalCommand } from "../../types/macros/Conditional/IConditionalCommand";
import { getUserScriptMemberAccess } from "../../utils/userScript";
import { ConditionalCommand } from "../../types/macros/Conditional/ConditionalCommand";
import { clearUserScriptSecretsFromCommand } from "../../utils/userScriptSecrets";
import { getObsidianCommands } from "../../utils/obsidianInternals";
import {
	isUnreadableCommandList,
	normalizeCommandList,
} from "../../utils/macroUtils";
import DataUnreadable from "../svelte/DataUnreadable.svelte";

/**
 * Opens a branch's commands as a page. Mutates the command when the page is
 * left and then calls `onEdited`, synchronously, so the edit is saved before
 * the page under it saves (see BuilderPage).
 */
type BranchHandler = (command: IConditionalCommand, onEdited: () => void) => void;

export interface CommandSequenceEditorConditionalHandlers {
	configureCondition?: (command: IConditionalCommand) => Promise<boolean>;
	editThenBranch?: BranchHandler;
	editElseBranch?: BranchHandler;
}

interface CommandSequenceEditorOptions {
	app: App;
	plugin: ChoiceBuilderPlugin;
	/**
	 * Typed `unknown` because it is not: this is `macro.commands` straight out of
	 * `data.json` (see commandListOf). The editor normalizes it at construction.
	 */
	commands: unknown;
	choices: IChoice[];
	onCommandsChange?: (commands: ICommand[]) => void;
	conditionalHandlers?: CommandSequenceEditorConditionalHandlers;
}

export class CommandSequenceEditor {
	private readonly app: App;
	private readonly plugin: ChoiceBuilderPlugin;
	private readonly choices: IChoice[];
	private readonly onCommandsChange?: (commands: ICommand[]) => void;
	private readonly conditionalHandlers?: CommandSequenceEditorConditionalHandlers;

	private commandsRef: ICommand[];
	/**
	 * True when the value handed to us was not a list we could read AND could
	 * still be carrying commands (see isUnreadableCommandList). The editor is
	 * read-only in that state: `commandsRef` is an empty array that must never
	 * reach disk over the real value.
	 */
	private readonly unreadable: boolean;
	private obsidianCommands: IObsidianCommand[] = [];
	private scriptCandidates: ScriptCandidate[] = [];
	private commandListHandle: MountHandle | null = null;
	private commandListProps: CommandListProps | null = null;
	private containerEl: HTMLElement | null = null;
	private unreadableCardHandle: MountHandle | null = null;
	private suggesters: GenericTextSuggester[] = [];

	constructor(options: CommandSequenceEditorOptions) {
		this.app = options.app;
		this.plugin = options.plugin;
		// data.json is untrusted, so the value arrives raw and is normalized here,
		// the one seam every command-list host goes through: a duplicate-id or
		// id-less command gets a fresh uuid instead of crashing the keyed {#each}.
		// Nothing is persisted until the user's first ordinary edit.
		this.unreadable = isUnreadableCommandList(options.commands);
		this.commandsRef = normalizeCommandList(options.commands).commands;
		this.choices = options.choices;
		this.onCommandsChange = options.onCommandsChange;
		this.conditionalHandlers = options.conditionalHandlers;

		this.loadObsidianCommands();
		this.loadScriptCandidates();
	}

	/**
	 * @returns whether the editor is fully usable. False means the command list is
	 * showing a card instead, and the host must not commit `commandsRef` anywhere
	 * (see ConditionalBranchEditorPage.result).
	 */
	public render(containerEl: HTMLElement): boolean {
		this.destroy();
		this.containerEl = containerEl;
		containerEl.empty();
		containerEl.addClass("quickAddCommandEditor");

		// A list we could not read must not be edited blind: every control below
		// would overwrite it with the [] we read it as, so offer nothing that
		// writes. The macro's name, run-on-startup and icon stay editable.
		if (this.unreadable) {
			this.renderUnreadableCard(containerEl);
			return false;
		}

		// A mount failure here is a genuine bug, but with the list invisible the
		// user would add commands they cannot see, so stop here too.
		if (!this.renderCommandList(containerEl)) return false;

		this.renderCommandBar(containerEl);
		this.renderAddObsidianCommandSetting(containerEl);
		this.renderAddEditorCommandSetting(containerEl);
		this.renderAddUserScriptSetting(containerEl);
		this.renderAddChoiceSetting(containerEl);
		return true;
	}

	private renderUnreadableCard(parent: HTMLElement) {
		const cardEl = parent.createDiv("commandList");
		this.unreadableCardHandle = mountComponent(
			cardEl,
			DataUnreadable,
			{ what: "this macro's commands" },
			{ what: "this macro's commands" },
		);
	}

	public destroy() {
		this.commandListHandle?.destroy();
		this.commandListHandle = null;
		this.commandListProps = null;
		this.unreadableCardHandle?.destroy();
		this.unreadableCardHandle = null;
		this.suggesters.forEach((suggester) => suggester.destroy());
		this.suggesters = [];
	}

	private loadObsidianCommands(): void {
		for (const command of Object.values(getObsidianCommands(this.app) ?? {})) {
			this.obsidianCommands.push(new ObsidianCommand(command.name, command.id));
		}
	}

	private loadScriptCandidates(): void {
		this.scriptCandidates = loadScriptCandidates(this.app);
	}

	/** @returns whether the list actually rendered (see render()). */
	private renderCommandList(parent: HTMLElement): boolean {
		const commandListEl = parent.createDiv("commandList");

		this.commandListProps = reactiveProps<CommandListProps>({
			app: this.app,
			plugin: this.plugin,
			commands: this.commandsRef,
			deleteCommand: async (commandId: string) => {
				const command = this.commandsRef.find((c) => c.id === commandId);

				if (!command) {
					log.logError("command not found");
					throw new Error("command not found");
				}

				const promptAnswer = await confirmAction(this.app, {
					title: `Delete '${command.name}'?`,
					message: "The command will be removed from this macro.",
					action: "Delete",
				});
				if (!promptAnswer) return;

				const secretsCleared = await clearUserScriptSecretsFromCommand(
					this.app,
					command
				);
				if (!secretsCleared) {
					new Notice(
						"Could not clear user script secrets. Command was not deleted."
					);
					return;
				}

				this.commandsRef = this.commandsRef.filter((c) => c.id !== commandId);
				this.emitCommandsChanged();
			},
			saveCommands: (commands: ICommand[]) => {
				this.commandsRef = commands;
				this.onCommandsChange?.(commands);
			},
			// Handlers mutate the command and return whether it changed; CommandList
			// persists the (proxy) mutation via its snapshot path.
			onConfigureCondition: this.conditionalHandlers?.configureCondition,
			onEditThenBranch: this.conditionalHandlers?.editThenBranch,
			onEditElseBranch: this.conditionalHandlers?.editElseBranch,
		});

		this.commandListHandle = mountComponent(
			commandListEl,
			CommandList,
			this.commandListProps,
			{ what: "this macro's commands" }
		);

		return this.commandListHandle.ok;
	}

	private renderCommandBar(parent: HTMLElement) {
		const quickCommandContainer: HTMLDivElement = parent.createDiv(
			"quickCommandContainer"
		);

		this.addChoiceButton(quickCommandContainer, "Capture", CaptureChoice);
		this.addChoiceButton(quickCommandContainer, "Template", TemplateChoice);
		this.addCommandButton(
			quickCommandContainer,
			"file-search",
			"Add open file command",
			() => new OpenFileCommand(),
		);
		this.addCommandButton(
			quickCommandContainer,
			"clock",
			"Add wait command",
			() => new WaitCommand(100),
		);
		this.addCommandButton(
			quickCommandContainer,
			"git-branch",
			"Add conditional command",
			() => new ConditionalCommand(),
		);

		if (!settingsStore.getState().disableOnlineFeatures) {
			this.addCommandButton(
				quickCommandContainer,
				"bot",
				"Add AI Assistant command",
				() => {
					const ai = settingsStore.getState().ai;
					return new AIAssistantCommand({
						model: ai.defaultModel,
						modelRef: activeModelRef(ai.defaultModel, ai.defaultModelRef),
						systemPrompt: ai.defaultSystemPrompt,
					});
				},
			);
		}
	}

	private renderAddObsidianCommandSetting(parent: HTMLElement) {
		let input: TextComponent;

		const addObsidianCommandFromInput = () => {
			const value: string = input.getValue();
			if (!value.trim()) return;
			const obsidianCommand = this.obsidianCommands.find((v) => v.name === value);

			if (!obsidianCommand) {
				log.logError(`Could not find Obsidian command with name "${value}"`);
				return;
			}

			const command = new ObsidianCommand(
				obsidianCommand.name,
				obsidianCommand.commandId
			);
			command.generateId();

			this.addCommand(command);

			input.setValue("");
		};

		new Setting(parent)
			.setName("Obsidian command")
			.setDesc("Add an Obsidian command")
			.addText((textComponent) => {
				input = this.configureSuggestedInput(
					textComponent,
					"Obsidian command",
					this.obsidianCommands.map((c) => c.name),
					addObsidianCommandFromInput,
				);
			})
			.addButton((button) =>
				button.setCta().setButtonText("Add").onClick(addObsidianCommandFromInput)
			);
	}

	private renderAddEditorCommandSetting(parent: HTMLElement) {
		let dropdownComponent: DropdownComponent;

		const addEditorCommandFromDropdown = () => {
			if (!dropdownComponent.getValue()) return;
			const create = editorCommands.get(dropdownComponent.getValue());
			if (!create) {
				log.logError("invalid editor command type");
				throw new Error("invalid editor command type");
			}
			this.addCommand(create());
			dropdownComponent.setValue("");
		};

		new Setting(parent)
			.setName("Editor commands")
			.setDesc("Add editor command")
			.addDropdown((dropdown) => {
				dropdownComponent = dropdown;
				dropdown.selectEl.addClass("qa-command-sequence-input");
				dropdown.addOption("", "Select command");
				for (const type of editorCommands.keys()) dropdown.addOption(type, type);
			})
			.addButton((button) =>
				button.setCta().setButtonText("Add").onClick(addEditorCommandFromDropdown)
			);
	}

	private renderAddUserScriptSetting(parent: HTMLElement) {
		let input!: TextComponent;
		let addButton: ButtonComponent | null = null;

		const addUserScriptFromInput = async () => {
			// Refresh so scripts/notes created while this editor is open resolve.
			this.loadScriptCandidates();
			const value: string = input.getValue().trim();
			if (!value) return;
			const selector = getUserScriptMemberAccess(value).basename ?? value;

			// Notes resolve by path (so a bare basename never picks a note over a
			// same-named .js); .js keeps basename matching. Member access (`::`) is
			// preserved in `value`, which becomes the command name.
			const resolved = resolveScriptSelector(
				this.app,
				this.scriptCandidates,
				selector,
			);
			if (!resolved) {
				new Notice(
					`QuickAdd: No script or js-block note named "${value}" found.`
				);
				return;
			}

			if (resolved.isMarkdown) {
				const reason = await noteScriptError(this.app, resolved.file);
				if (reason) {
					new Notice(`QuickAdd: "${resolved.file.path}" — ${reason}`);
					return;
				}
			}

			this.addCommand(new UserScript(value, resolved.file.path));

			input.setValue("");
			if (addButton) {
				addButton.buttonEl.addClass("qa-hidden");
			}
		};

		new Setting(parent)
			.setName("User scripts")
			.setDesc("Add a .js file or a note with a ```js code block - type the name or click Browse")
			.addText((textComponent) => {
				input = this.configureSuggestedInput(
					textComponent,
					"Start typing script name...",
					candidateLabels(this.scriptCandidates),
					addUserScriptFromInput,
				);
			})
			.addButton((button) =>
				button
					.setButtonText("Browse")
					.setTooltip("Browse and select a script (.js file or note)")
					// Obsidian drops the click handler's promise: without this, pressing
					// Escape in the picker is an unhandled rejection.
					.onClick(reportingHandler("Couldn't add that script", async () => {
						const script = await this.showScriptPicker();
						if (script) this.addCommand(script);
					}))
			)
			.addButton((button) => {
				addButton = button;
				button
					.setButtonText("Add")
					.setCta()
					.onClick(() => void addUserScriptFromInput());
				button.buttonEl.addClass("qa-hidden");
			});

		input.onChange((value) => {
			if (!addButton) return;
			addButton.buttonEl.toggleClass("qa-hidden", value.trim().length === 0);
		});
	}

	private renderAddChoiceSetting(parent: HTMLElement) {
		let input: TextComponent;

		const addChoiceFromInput = () => {
			const value: string = input.getValue();
			if (!value.trim()) return;
			const choice = this.choices.find((c) => c.name === value);
			if (!choice) {
				new Notice(`QuickAdd: No choice named "${value}".`);
				return;
			}

			this.addCommand(new ChoiceCommand(choice.name, choice.id));

			input.setValue("");
		};

		new Setting(parent)
			.setName("Choices")
			.setDesc("Add existing choice")
			.addText((textComponent) => {
				input = this.configureSuggestedInput(
					textComponent,
					"Choice",
					this.choices.map((c) => c.name),
					addChoiceFromInput,
				);
			})
			.addButton((button) =>
				button.setCta().setButtonText("Add").onClick(addChoiceFromInput)
			);
	}

	private configureSuggestedInput(
		input: TextComponent,
		placeholder: string,
		suggestions: string[],
		add: () => void | Promise<void>,
	): TextComponent {
		input.inputEl.addClass("qa-command-sequence-input");
		input.setPlaceholder(placeholder);
		this.suggesters.push(new GenericTextSuggester(this.app, input.inputEl, suggestions));
		input.inputEl.addEventListener("keypress", (event: KeyboardEvent) => {
			if (event.key === "Enter") void add();
		});
		return input;
	}

	private addChoiceButton(
		container: HTMLDivElement,
		typeName: string,
		Type: typeof TemplateChoice | typeof CaptureChoice
	) {
		const button: ButtonComponent = new ButtonComponent(container);
		button
			.setButtonText(typeName)
			.setTooltip(`Add ${typeName} choice`)
			.onClick(() => {
				// NOT lowercased with the tooltip above: this is a persisted choice
				// NAME, not a label, so changing it would only split existing and
				// newly created choices into two spellings.
				const newChoice: IChoice = new Type(`Untitled ${typeName} Choice`);
				this.addCommand(new NestedChoiceCommand(newChoice));
			});
	}

	private addCommandButton(
		container: HTMLDivElement,
		icon: string,
		tooltip: string,
		create: () => ICommand,
	) {
		new ButtonComponent(container)
			.setIcon(icon)
			.setTooltip(tooltip)
			.onClick(() => this.addCommand(create()));
	}

	private async showScriptPicker(): Promise<UserScript | null> {
		// Refresh so scripts/notes created while this editor is open are listed.
		this.loadScriptCandidates();
		if (this.scriptCandidates.length === 0) {
			showNoScriptsFoundNotice(this.app);
			return null;
		}

		// One unified list: .js paths and notes-with-a-code-block, keyed by path.
		// Rows show the name with the full path beneath it, and search matches
		// both, so same-named scripts in different folders can be told apart and
		// a note is found by the name its row shows.
		const paths = this.scriptCandidates.map((c) => c.file.path);
		const labels = candidateLabels(this.scriptCandidates);
		const titles = buildFileDisplayInfos(
			this.scriptCandidates.map((c) => c.file),
			(file) => this.app.metadataCache.getFileCache(file),
		);
		const selectedPath = await InputSuggester.Suggest(
			this.app,
			labels,
			paths,
			{
				placeholder: "Select a script (.js file or note with a ```js block)",
				renderItem: (path, el, matches) => renderNotePathSuggestion(el, path, this.app, {
					matches,
					pathOffset: titles[paths.indexOf(path)].primary.length + 1,
				}),
				searchItems: paths.map((path, index) => `${titles[index].primary} ${path}`),
				allowCustomValue: false,
			}
		);

		const index = paths.indexOf(selectedPath);
		if (index === -1) return null;
		const candidate = this.scriptCandidates[index];

		if (candidate.isMarkdown) {
			const reason = await noteScriptError(this.app, candidate.file);
			if (reason) {
				new Notice(`QuickAdd: "${candidate.file.path}" — ${reason}`);
				return null;
			}
		}

		return new UserScript(labels[index], candidate.file.path);
	}

	private addCommand(command: ICommand) {
		// Immutable add: callers (MacroBuilder, ConditionalBranchEditorPage) track
		// changes via onCommandsChange, not in-place mutation of the passed array.
		this.commandsRef = [...this.commandsRef, command];
		this.emitCommandsChanged();
	}

	private emitCommandsChanged() {
		// Push the new array into the mounted component via its reactive $state props.
		if (this.commandListProps) {
			this.commandListProps.commands = [...this.commandsRef];
		}
		this.onCommandsChange?.(this.commandsRef);
	}
}
