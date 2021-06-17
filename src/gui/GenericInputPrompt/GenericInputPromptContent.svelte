<script lang="ts">
    import {GenericTextSuggester} from "../genericTextSuggester";
    import {onMount} from "svelte";
    import {App} from "obsidian";
    import {SilentFileAndTagSuggester} from "../silentFileAndTagSuggester";

    export let header: string = "";
    export let placeholder: string = "";
    export let value: string = "";
    export let onSubmit: (value: string) => void;
    export let app: App;

    let inputEl: HTMLInputElement;
    let suggester: SilentFileAndTagSuggester;

    onMount(() => {
        suggester = new SilentFileAndTagSuggester(app, inputEl);
    });

    function submit(evt: KeyboardEvent) {
        if (evt.key === "Enter") {
            evt.preventDefault();
            onSubmit(value);
        }
    }
</script>

<div class="quickAddPrompt">
    <h1 style="text-align: center">{header}</h1>
    <input bind:this={inputEl}
           bind:value={value}
           class="quickAddPromptInput"
           on:keydown={submit}
           placeholder={placeholder}
           style="width: 100%;"
           type="text">
</div>