<script lang="ts">
    import IChoice from "../../types/choices/IChoice";
    import {ChoiceType} from "../../types/choices/choiceType";
    import ChoiceList from "./ChoiceList.svelte";
    import IMultiChoice from "../../types/choices/IMultiChoice";
    import {v4 as uuidv4} from "uuid";
    import AddChoiceBox from "./AddChoiceBox.svelte";
    import type ITemplateChoice from "../../types/choices/ITemplateChoice";
    import {TemplateChoice} from "../../types/choices/TemplateChoice";
    import type IMacroChoice from "../../types/choices/IMacroChoice";
    import {MacroChoice} from "../../types/choices/MacroChoice";
    import type ICaptureChoice from "../../types/choices/ICaptureChoice";
    import {CaptureChoice} from "../../types/choices/CaptureChoice";
    import {MultiChoice} from "../../types/choices/MultiChoice";

    export let choices: IChoice[] = [
        {name: '🚶‍♂️ Journal', type: ChoiceType.Template, id: uuidv4()},
        {name: '📖 Log Book to Daily Journal', type: ChoiceType.Template, id: uuidv4()},
        <IMultiChoice>{
            name: '📥 Add...', type: ChoiceType.Multi, id: uuidv4(), collapsed: false, choices: [
                {name: '💭 Add a Thought', type: ChoiceType.Capture, id: uuidv4()},
                {name: '📥 Add an Inbox Item', type: ChoiceType.Template, id: uuidv4()},
                {name: '📕 Add Book Notes', type: ChoiceType.Template, id: uuidv4()},
            ]
        },
        {name: "✍ Quick Capture", type: ChoiceType.Capture, id: uuidv4()},
        {name: '💬 Add Quote Page', type: ChoiceType.Template, id: uuidv4()},
        <IMultiChoice>{
            name: '🌀 Task Manager', type: ChoiceType.Multi, id: uuidv4(), collapsed: false, choices: [
                {name: '✔ Add a Task', type: ChoiceType.Macro, id: uuidv4()},
                {name: '✔ Quick Capture Task', type: ChoiceType.Capture, id: uuidv4()},
                {name: '✔ Add MetaEdit Backlog Task', type: ChoiceType.Capture, id: uuidv4()},
            ]
        },
        {name: '💸 Add Purchase', type: ChoiceType.Capture, id: uuidv4()}
    ];

    export let saveChoices: (choices: IChoice[]) => void;

    const addChoiceToList: (event: any) => void = (event: any) => {
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
    };
</script>

<div>
    <h3>Choices</h3>
    <ChoiceList type="main" bind:choices />
    <AddChoiceBox on:addChoice={addChoiceToList} />
</div>
