<script lang="ts">
    import Choice from "../../types/choices/choice";
    import {ChoiceType} from "../../types/choices/choiceType";
    import ChoiceList from "./ChoiceList.svelte";
    import MultiChoice from "../../types/choices/multiChoice";
    import {v4 as uuidv4} from "uuid";
    import AddChoiceBox from "./AddChoiceBox.svelte";

    export let choices: Choice[] = [
        {name: '🚶‍♂️ Journal', type: ChoiceType.Template, id: uuidv4()},
        {name: '📖 Log Book to Daily Journal', type: ChoiceType.Template, id: uuidv4()},
        <MultiChoice>{
            name: '📥 Add...', type: ChoiceType.Multi, id: uuidv4(), collapsed: false, choices: [
                {name: '💭 Add a Thought', type: ChoiceType.Capture, id: uuidv4()},
                {name: '📥 Add an Inbox Item', type: ChoiceType.Template, id: uuidv4()},
                {name: '📕 Add Book Notes', type: ChoiceType.Template, id: uuidv4()},
            ]
        },
        {name: "✍ Quick Capture", type: ChoiceType.Capture, id: uuidv4()},
        {name: '💬 Add Quote Page', type: ChoiceType.Template, id: uuidv4()},
        <MultiChoice>{
            name: '🌀 Task Manager', type: ChoiceType.Multi, id: uuidv4(), collapsed: false, choices: [
                {name: '✔ Add a Task', type: ChoiceType.Macro, id: uuidv4()},
                {name: '✔ Quick Capture Task', type: ChoiceType.Capture, id: uuidv4()},
                {name: '✔ Add MetaEdit Backlog Task', type: ChoiceType.Capture, id: uuidv4()},
            ]
        },
        {name: '💸 Add Purchase', type: ChoiceType.Capture, id: uuidv4()}
    ];

    export let saveChoices: (choices: Choice[]) => void;
</script>

<div>
    <h3>Choices</h3>
    <ChoiceList type="main" bind:choices />
    <AddChoiceBox />
</div>
