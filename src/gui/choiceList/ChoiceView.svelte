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
            choices = choices.filter((value, index, array) => deleteChoiceHelper(id, value, index, array));
            saveChoices(choices);
        }
    }

    function deleteChoiceHelper(id: string, value: IChoice, index: number, array: IChoice[]): boolean {
        if (value instanceof MultiChoice) {
            value.choices = value.choices.filter(this);

            return true;
        }

        return value.id !== id;
    }
</script>

<div>
    <h3>Choices</h3>
    <ChoiceList type="main" bind:choices on:deleteChoice={deleteChoice} />
    <AddChoiceBox on:addChoice={addChoiceToList} />
</div>
