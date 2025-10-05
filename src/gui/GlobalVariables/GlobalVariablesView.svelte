<script lang="ts">
import { onDestroy, onMount } from "svelte";
import type { App } from "obsidian";
import { settingsStore } from "../../settingsStore";
import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
import type QuickAdd from "../../main";

export let app: App;
export let plugin: QuickAdd;

type GV = { name: string; value: string };
let items: GV[] = [];

let unsubscribe: () => void;

function uniqueName(base: string, existing: Set<string>): string {
	if (!existing.has(base)) return base;
	let i = 1;
	while (existing.has(`${base}${i}`)) i++;
	return `${base}${i}`;
}

function loadFromSettings() {
	const state = settingsStore.getState();
	const globals = state.globalVariables || {};
	// Preserve insertion order of object keys
	items = Object.keys(globals).map((k) => ({
		name: k,
		value: globals[k] ?? "",
	}));
}

function persistToSettings() {
	const next: Record<string, string> = {};
	for (const it of items) {
		if (!it.name) continue;
		next[it.name] = it.value ?? "";
	}
	settingsStore.setState({ globalVariables: next });
}

function _addVariable() {
	const names = new Set(items.map((i) => i.name));
	const name = uniqueName("NewVar", names);
	items = [...items, { id: name, name, value: "" }];
	persistToSettings();
}

function _deleteVariable(idx: number) {
	items = items.filter((_, i) => i !== idx);
	persistToSettings();
}

// Drag-and-drop is intentionally not supported for Global Variables

// Attach format suggester to inputs
function _attachSuggester(el: HTMLTextAreaElement | HTMLInputElement) {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const _suggester = new FormatSyntaxSuggester(app, el, plugin);
	return {
		destroy() {
			// Suggesters clean up themselves on blur/close; no explicit API needed
		},
	};
}

let debounceTimer: any;
function _debouncedPersist(_it: GV) {
	clearTimeout(debounceTimer);
	debounceTimer = setTimeout(() => {
		persistToSettings();
	}, 200);
}

onMount(() => {
	unsubscribe = settingsStore.subscribe(() => loadFromSettings());
	loadFromSettings();
});
onDestroy(() => unsubscribe?.());
</script>

<div class="qa-gv">
  <div class="qa-gv__header">
    <div class="qa-gv__title">Global Variables</div>
    <div class="qa-gv__actions">
      <button class="mod-cta" on:click={addVariable}>Add variable</button>
    </div>
  </div>
  <div class="qa-gv__desc">
    Define reusable snippets referenced as <code>&#123;&#123;GLOBAL_VAR:&lt;name&gt;&#125;&#125;</code>. Snippets support other QuickAdd tokens and expand before VALUE/VDATE/etc.
  </div>

  <div class="qa-gv__table">
    <div class="qa-gv__row qa-gv__row--head">
      <div class="qa-gv__cell qa-gv__name">Name</div>
      <div class="qa-gv__cell qa-gv__value">Value</div>
      <div class="qa-gv__cell qa-gv__ops">Actions</div>
    </div>
    {#each items as it, idx}
      <div class="qa-gv__row">
        <div class="qa-gv__cell qa-gv__name">
          <input type="text"
                 use:attachSuggester
                 bind:value={it.name}
                 on:input={() => { debouncedPersist(it); }}
                 placeholder="Name" />
        </div>
        <div class="qa-gv__cell qa-gv__value">
          <textarea rows="2"
                    use:attachSuggester
                    bind:value={it.value}
                    on:input={() => debouncedPersist(it)}
                    placeholder="Snippet value (supports QuickAdd tokens)"></textarea>
        </div>
        <div class="qa-gv__cell qa-gv__ops">
          <button class="qa-gv__btn danger" title="Delete" on:click={() => deleteVariable(items.indexOf(it))}>Delete</button>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .qa-gv { display: flex; flex-direction: column; gap: 8px; }
  .qa-gv__header { display: flex; justify-content: space-between; align-items: center; }
  .qa-gv__title { font-weight: 600; font-size: 16px; }
  .qa-gv__desc { color: var(--text-muted); font-size: 12px; }
  .qa-gv__table { display: grid; gap: 8px; }
  .qa-gv__row { display: grid; grid-template-columns: 180px 1fr 140px; gap: 8px; align-items: start; }
  .qa-gv__row--head { font-weight: 600; color: var(--text-muted); }
  .qa-gv__cell input[type="text"] { width: 100%; }
  .qa-gv__cell textarea { width: 100%; resize: vertical; }
  .qa-gv__ops { display: flex; gap: 6px; align-items: center; }
  .qa-gv__btn { padding: 4px 8px; }
  .qa-gv__btn.danger { color: var(--text-error); }
  @media (max-width: 900px) {
    .qa-gv__row { grid-template-columns: 1fr; }
    .qa-gv__row--head { display: none; }
  }
</style>
