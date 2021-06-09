<script lang="ts">
    import Choice from "../../types/choices/choice";
    import {ChoiceType} from "../../types/choices/choiceType";
    import ChoiceList from "./ChoiceList.svelte";
    import MultiChoice from "../../types/choices/multiChoice";
    import {v4 as uuidv4} from "uuid";

    export let choices: Choice[] = [
        {name: 'templateChoice', type: ChoiceType.Template, id: uuidv4()},
        <MultiChoice>{name: 'multiChoice', type: ChoiceType.Multi, id: uuidv4(), choices: [
            {name: 'captureChoice', type: ChoiceType.Capture, id: uuidv4()},
            <MultiChoice>{name: 'nestedMultiChoice', type: ChoiceType.Multi, id: uuidv4(), choices: [
                    {name: 'macroChoice', type: ChoiceType.Macro, id: uuidv4()}
                ]}
        ]}
    ];
    export let saveChoices: (choices: Choice[]) => void;
</script>

<div>
    <h3>Choices</h3>
    <ChoiceList type="main" bind:choices />
</div>
