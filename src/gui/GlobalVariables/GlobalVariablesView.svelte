<script lang="ts">
  import type { App } from "obsidian";
  import { settingsStore } from "../../settingsStore";
  import { FormatSyntaxSuggester } from "../suggesters/formatSyntaxSuggester";
  import type QuickAdd from "../../main";

  let { app, plugin }: { app: App; plugin: QuickAdd } = $props();

  type GV = { name: string; value: string };
  let items = $state<GV[]>([]);

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
    items = Object.keys(globals).map((k) => ({ name: k, value: globals[k] ?? "" }));
  }

  // True while this component is writing its own (valid) edits to the store, so
  // the store subscriber does not reload (and collapse) the rows the user is
  // actively editing. Invalid states (empty or duplicate names) are never
  // written at all (see persistToSettings), so they can't corrupt the store.
  let suppressReload = false;

  function persistToSettings() {
    // Never publish a lossy record. An empty name can't be keyed (it would be
    // dropped) and duplicate names collapse last-wins — writing either to the
    // store (and the debounced data.json save) is the data-loss footgun. While
    // any name is empty or duplicated, keep the edit local and leave the
    // previously-persisted values intact until the names are valid again.
    // Validate and persist on TRIMMED names: the {{GLOBAL_VAR:<name>}} token
    // trims the name before lookup, so a whitespace-only name ("   ") is
    // effectively empty and "foo " collides with "foo". Treat both as
    // invalid/duplicate (keep the edit local) and write trimmed, referenceable
    // keys when valid.
    const names = items.map((it) => it.name.trim());
    const hasEmpty = names.some((n) => !n);
    const hasDuplicate = new Set(names).size !== names.length;
    if (hasEmpty || hasDuplicate) return;

    const next: Record<string, string> = {};
    for (const it of items) {
      next[it.name.trim()] = it.value ?? "";
    }
    suppressReload = true;
    try {
      settingsStore.setState({ globalVariables: next });
    } finally {
      suppressReload = false;
    }
  }

  function addVariable() {
    const names = new Set(items.map((i) => i.name));
    const name = uniqueName("NewVar", names);
    items = [...items, { name, value: "" }];
    persistToSettings();
  }

  function deleteVariable(idx: number) {
    items = items.filter((_, i) => i !== idx);
    persistToSettings();
  }

  // Drag-and-drop is intentionally not supported for Global Variables

  // Attach format suggester to inputs
  function attachSuggester(el: HTMLTextAreaElement | HTMLInputElement) {
    // Constructed for its side effect (it wires itself to the element).
    new FormatSyntaxSuggester(app, el, plugin);
    return {
      destroy() {
        // Suggesters clean up themselves on blur/close; no explicit API needed
      },
    };
  }

  let debounceTimer: number | undefined;
  function debouncedPersist(it: GV) {
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      persistToSettings();
    }, 200);
  }

  $effect(() => {
    const unsubscribe = settingsStore.subscribe(() => {
      // Ignore the store change this component just produced, so our own
      // debounced persist does not reload over the rows being edited.
      if (suppressReload) return;
      loadFromSettings();
    });
    loadFromSettings();
    return () => {
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      unsubscribe();
    };
  });
</script>

<div class="qa-gv">
  <div class="qa-gv__header">
    <div class="qa-gv__title">Global Variables</div>
    <div class="qa-gv__actions">
      <button class="mod-cta" onclick={addVariable}>Add variable</button>
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
    {#each items as it, idx (idx)}
      <div class="qa-gv__row">
        <div class="qa-gv__cell qa-gv__name">
          <input type="text"
                 use:attachSuggester
                 bind:value={it.name}
                 oninput={() => { debouncedPersist(it); }}
                 placeholder="Name" />
        </div>
        <div class="qa-gv__cell qa-gv__value">
          <textarea rows="2"
                    use:attachSuggester
                    bind:value={it.value}
                    oninput={() => debouncedPersist(it)}
                    placeholder="Snippet value (supports QuickAdd tokens)"></textarea>
        </div>
        <div class="qa-gv__cell qa-gv__ops">
          <button class="qa-gv__btn danger" title="Delete" onclick={() => deleteVariable(items.indexOf(it))}>Delete</button>
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
