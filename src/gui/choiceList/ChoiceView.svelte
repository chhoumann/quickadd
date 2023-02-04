<script lang="ts">
    import IChoice from "../../types/choices/IChoice";
    import {ChoiceType} from "../../types/choices/choiceType";
    import ChoiceList from "./ChoiceList.svelte";
    import IMultiChoice from "../../types/choices/IMultiChoice";
    import AddChoiceBox from "./AddChoiceBox.svelte";
    import type ITemplateChoice from "../../types/choices/ITemplateChoice";
    import {TemplateChoice} from "../../types/choices/TemplateChoice";
    import type IMacroChoice from "../../types/choices/IMacroChoice";
    import {MacroChoice} from "../../types/choices/MacroChoice";
    import type ICaptureChoice from "../../types/choices/ICaptureChoice";
    import {CaptureChoice} from "../../types/choices/CaptureChoice";
    import {MultiChoice} from "../../types/choices/MultiChoice";
    import GenericYesNoPrompt from "../GenericYesNoPrompt/GenericYesNoPrompt";
    import {App} from "obsidian";
    import {TemplateChoiceBuilder} from "../ChoiceBuilder/templateChoiceBuilder";
    import {CaptureChoiceBuilder} from "../ChoiceBuilder/captureChoiceBuilder";
    import {MacroChoiceBuilder} from "../ChoiceBuilder/macroChoiceBuilder";
    import {MacrosManager} from "../../MacrosManager";
    import type {IMacro} from "../../types/macros/IMacro";
    import QuickAdd from "../../main";
    import GenericInputPrompt from "../GenericInputPrompt/GenericInputPrompt";
	import { excludeKeys, getChoiceType } from "src/utility";

    export let choices: IChoice[] = [];
    export let macros: IMacro[] = [];

    export let saveChoices: (choices: IChoice[]) => void;
    export let saveMacros: (macros: IMacro[]) => void;
    export let app: App;
    export let plugin: QuickAdd;

    function addChoiceToList(event: any): void {
        const {name, type} = event.detail;

        switch (type) {
            case ChoiceType.Template:
                const templateChoice: ITemplateChoice = new TemplateChoice(name);
                choices = [...choices, templateChoice];
                break;
            case ChoiceType.Capture:
                const captureChoice: ICaptureChoice = new CaptureChoice(name);
                choices = [...choices, captureChoice];
                break;
            case ChoiceType.Macro:
                const macroChoice: IMacroChoice = new MacroChoice(name);
                choices = [...choices, macroChoice];
                break;
            case ChoiceType.Multi:
                const multiChoice: IMultiChoice = new MultiChoice(name);
                choices = [...choices, multiChoice];
                break;
        }

        saveChoices(choices);
    }

    async function deleteChoice(e: any) {
        const choice: IChoice = e.detail.choice;

        const userConfirmed: boolean = await GenericYesNoPrompt.Prompt(app,
            `Confirm deletion of choice`, `Please confirm that you wish to delete '${choice.name}'.
            ${choice.type === ChoiceType.Multi
                ? "Deleting this choice will delete all (" + (choice as IMultiChoice).choices.length + ") choices inside it!"
                : ""}
            `);

        if (userConfirmed) {
            choices = choices.filter((value) => deleteChoiceHelper(choice.id, value));
            plugin.removeCommandForChoice(choice);
            saveChoices(choices);
        }
    }

    function deleteChoiceHelper(id: string, value: IChoice): boolean {
        if (value.type === ChoiceType.Multi) {
            (value as IMultiChoice).choices = (value as IMultiChoice).choices
                .filter((v) => deleteChoiceHelper(id, v));
        }

        return value.id !== id;
    }

    async function configureChoice(e: any) {
        const {choice: oldChoice} = e.detail;

        let updatedChoice;
        if (oldChoice.type === ChoiceType.Multi) {
            updatedChoice = oldChoice;

            const name = await GenericInputPrompt.Prompt(app, `Rename ${oldChoice.name}`, '', oldChoice.name);
            if (!name) return;

            updatedChoice.name = name;
        } else {
            updatedChoice = await getChoiceBuilder(oldChoice).waitForClose;
        }

        if (!updatedChoice) return;

        choices = choices.map(choice => updateChoiceHelper(choice, updatedChoice));
        saveChoices(choices);
    }

    async function toggleCommandForChoice(e: any) {
        const {choice: oldChoice} = e.detail;
        const updatedChoice = {...oldChoice, command: !oldChoice.command};

        updatedChoice.command ?
            plugin.addCommandForChoice(updatedChoice) :
            plugin.removeCommandForChoice(updatedChoice);

        choices = choices.map(choice => updateChoiceHelper(choice, updatedChoice));
        saveChoices(choices);
    } 

    async function handleDuplicateChoice(e: any) {
        const {choice: sourceChoice} = e.detail;

        const newChoice = duplicateChoice(sourceChoice);

        choices = [...choices, newChoice];
        saveChoices(choices);
    }

    function duplicateChoice(choice: IChoice) {
        if (!getChoiceType(choice)) throw new Error('Invalid choice type');

        let newChoice;

        switch ((choice as IChoice).type) {
            case ChoiceType.Template:
                newChoice = new TemplateChoice(`${choice.name} (copy)`);
                break;
            case ChoiceType.Capture:
                newChoice = new CaptureChoice(`${choice.name} (copy)`);
                break;
            case ChoiceType.Macro:
                newChoice = new MacroChoice(`${choice.name} (copy)`);
                break;
            case ChoiceType.Multi:
                newChoice = new MultiChoice(`${choice.name} (copy)`);
                break;
        }

        if (choice.type !== ChoiceType.Multi) {
            Object.assign(newChoice, excludeKeys(choice, ['id', 'name']));
        } else {
            (newChoice as IMultiChoice).choices = (choice as IMultiChoice).choices.map(c => duplicateChoice(c));
        }

        return newChoice;
    }

    function updateChoiceHelper(oldChoice: IChoice, newChoice: IChoice) {
        if (oldChoice.id === newChoice.id) {
            oldChoice = {...oldChoice, ...newChoice};
            return oldChoice;
        }

        if (oldChoice.type === ChoiceType.Multi) {
            const multiChoice = (oldChoice as IMultiChoice);
            const multiChoiceChoices = multiChoice.choices.map(c => updateChoiceHelper(c, newChoice))
            return {...multiChoice, choices: multiChoiceChoices} as IChoice;
        }

        return oldChoice;
    }

    function getChoiceBuilder(choice: IChoice) {
        switch (choice.type) {
            case ChoiceType.Template:
                return new TemplateChoiceBuilder(app, choice as ITemplateChoice, plugin);
            case ChoiceType.Capture:
                return new CaptureChoiceBuilder(app, choice as ICaptureChoice, plugin);
            case ChoiceType.Macro:
                return new MacroChoiceBuilder(app, choice as IMacroChoice, macros);
            case ChoiceType.Multi:
            default:
                break;
        }
    }

    async function openMacroManager() {
        const newMacros: IMacro[] = await new MacrosManager(app, plugin, macros, choices).waitForClose;

        if (newMacros) {
            saveMacros(newMacros);
            macros = newMacros;
        }
    }
</script>

<div>
    <ChoiceList
            type="main"
            bind:choices
            on:deleteChoice={deleteChoice}
            on:configureChoice={configureChoice}
            on:toggleCommand={toggleCommandForChoice}
            on:duplicateChoice={handleDuplicateChoice}
            on:reorderChoices={e => saveChoices(e.detail.choices)}
    />
    <div class="choiceViewBottomBar">
        <button class="mod-cta" on:click={openMacroManager}>Manage Macros</button>
        <AddChoiceBox on:addChoice={addChoiceToList} />
    </div>
</div>

<style>
    .choiceViewBottomBar {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        margin-top: 1rem;
    }

    @media (max-width: 800px) {
        .choiceViewBottomBar {
            flex-direction: column;
        }
    }
</style>