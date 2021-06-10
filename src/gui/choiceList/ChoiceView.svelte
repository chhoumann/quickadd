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

    export let choices: IChoice[] = [];

    export let saveChoices: (choices: IChoice[]) => void;
    export let app: App;

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
        const {choiceId: id, choiceName} = e.detail;

        const userConfirmed: boolean = await GenericYesNoPrompt.Prompt(app,
            `Confirm deletion of choice`, `Please confirm that you wish to delete '${choiceName}.'`);

        if (userConfirmed) {
            choices = choices.filter((value) => deleteChoiceHelper(id, value));
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
        const updatedChoice = await getChoiceBuilder(oldChoice).waitForClose;
        if (!updatedChoice) return;

        choices = choices.map(choice => updateChoiceHelper(choice, updatedChoice));
        saveChoices(choices);
    }

    function updateChoiceHelper(oldChoice: IChoice, newChoice: IChoice) {
        if (oldChoice.id === newChoice.id)
                return newChoice;

        if (oldChoice.type === ChoiceType.Multi) {
            (oldChoice as IMultiChoice).choices.map(c => updateChoiceHelper(c, newChoice))
        }

        return oldChoice;
    }

    function getChoiceBuilder(choice: IChoice) {
        switch (choice.type) {
            case ChoiceType.Template:
                return new TemplateChoiceBuilder(app, choice as ITemplateChoice);
            case ChoiceType.Capture:
            case ChoiceType.Macro:
            case ChoiceType.Multi:
                break;
            default:
                break;
        }
    }
</script>

<div>
    <ChoiceList
            type="main"
            bind:choices
            on:deleteChoice={deleteChoice}
            on:configureChoice={configureChoice}/>
    <AddChoiceBox on:addChoice={addChoiceToList} />
</div>
