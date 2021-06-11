<script lang="ts">
    import type {App} from "obsidian";
    export let app: App;
    export let header: string = "";
    export let placeholder: string = "";
    export let value: string = "";
    export let onSubmit: (value: string) => void;

    let inputEl: HTMLInputElement;

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