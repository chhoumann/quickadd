<script lang="ts">
    import Choice from "../../types/choices/choice";
    import {ChoiceType} from "../../types/choices/choiceType";
    import ChoiceList from "./ChoiceList.svelte";
    import MultiChoice from "../../types/choices/multiChoice";

    export let choices: Choice[] = [
        {name: 'templateChoice', type: ChoiceType.Template},
        <MultiChoice>{name: 'multiChoice', type: ChoiceType.Multi, choices: [
            {name: 'captureChoice', type: ChoiceType.Capture},
            <MultiChoice>{name: 'nestedMultiChoice', type: ChoiceType.Multi, choices: [
                    {name: 'macroChoice', type: ChoiceType.Macro}
                ]}
        ]}
    ];
    export let saveChoices: (choices: Choice[]) => void;
</script>

<div>
    <h3>Choices</h3>
    <ChoiceList bind:choices />
</div>
