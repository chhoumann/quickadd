<script lang="ts">
    export let header: string = "";
    export let value: string = "";
    export let text: string = "";
    export let onSubmit: (value: boolean) => void;

    function submit(answer: boolean) {
        onSubmit(answer);
    }

</script>

<div class="quickAddYesNoPrompt">
    <h1 style="text-align: center">{header}</h1>

    <p>{text}</p>

    <div class="yesNoPromptButtonContainer">
        <button class="mod-cta" on:click={() => submit(false)}>No</button>
        <button class="mod-warning" on:click={() => submit(true)}>Yes</button>
    </div>
</div>

<style>
    .yesNoPromptButtonContainer {
        display: flex;
        align-items: center;
        justify-content: space-around;
        margin-top: 2rem;
    }

    p {
        text-align: center;
    }

    button {
        font-size: 18px;
    }
</style>