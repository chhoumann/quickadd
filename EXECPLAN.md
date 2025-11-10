# Enable Provider-Native Model Discovery


This ExecPlan is a living document. Update every section—especially Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective—whenever new information emerges or work completes. No PLANS.md file exists in this repo, so this plan defines the required structure.


## Purpose / Big Picture


Users will be able to browse and auto-sync AI models from any OpenAI-compatible endpoint they configure, not just the handful of vendors mirrored on models.dev. After implementing this plan, someone can point QuickAdd at a private Azure/OpenRouter-compatible `/v1/models` endpoint, click “Browse models,” and see that endpoint’s catalog populate without relying on models.dev. Automatic sync will likewise respect the same source so providers that are invisible to models.dev still work.


## Progress


- [x] (2025-11-10 18:45Z) Captured the user-facing problem statement from GitHub issue #969 and inventoried current model-fetch code paths.
- [x] (2025-11-10 19:05Z) Added `modelSource` plumbing to `AIProvider`, default providers, provider creation flows, and a migration to backfill existing settings.
- [x] (2025-11-10 19:25Z) Implemented provider-native discovery service plus `/v1/models` parser and targeted tests.
- [x] (2025-11-10 19:40Z) Updated UI/settings/docs, wired auto-sync & browse flows to the discovery service, and validated via lint/test/build.


## Surprises & Discoveries


Observation: `src/ai/modelsDirectory.ts` hardcodes `https://models.dev/api.json` plus a provider-name lookup. Any endpoint not in `mapEndpointToModelsDevKey` throws before UI can render, explaining why custom providers “bug out.” Evidence: `getModelsForProvider` throws the string “Could not determine models.dev provider for endpoint: ${provider.endpoint}` when the endpoint map misses.

Observation: The “Browse models” modal (`src/gui/ModelDirectoryModal.ts`) assumes models.dev metadata (id, name, limit.context), so it must be generalized before it can display raw `/v1/models` payloads. Evidence: `loadData()` always calls `fetchModelsDevDirectory()` prior to `getModelsForProvider`.

Observation: Importing `settingsStore` in Vitest pulls Svelte components (e.g., `ChoiceView.svelte`) that require the Svelte Vite plugin, so unit tests need to mock the store instead of touching the real module. Evidence: running `vitest` on the new discovery tests initially failed with a Vite import-analysis error until the module was mocked.

Observation: Providers often publish their API at endpoints that already end with `/v1` (OpenRouter, Groq, etc.) while others expect `/v1` to be appended. The first draft double-appended `/v1`, breaking every request. Evidence: running live probes against OpenRouter produced requests to `/v1/v1/models` until the URL builder was fixed to detect an existing version suffix.

Observation: Local providers such as Ollama do not require API keys, and forcing one prevented provider-native discovery entirely. Evidence: the live Ollama test failed with “Provider API key is required…” until the service was relaxed to send Authorization headers only when a key exists.


## Decision Log


Decision: Introduce a per-provider `modelSource` field with values `modelsDev`, `providerApi`, or `auto` (tries provider API first, falls back to models.dev) instead of a global switch. Rationale: Users may mix providers; some (Gemini) lack OpenAI-compatible endpoints while others (custom OpenAI clones) are invisible to models.dev. A per-provider mode avoids regressions and keeps the UI explainable. Date/Author: 2025-11-10 / Codex agent.

Decision: Default `modelSource` to `providerApi` for newly created custom providers and `modelsDev` for built-in defaults, then run a migration to set `auto` when the endpoint host contains `openai.com` or `openrouter.ai`. Rationale: Preserves current experience for stock providers while immediately fixing the custom-provider bug. Date/Author: 2025-11-10 / Codex agent.

Decision: Parse `/v1/models` responses by accepting either `{ data: [...] }` objects or bare arrays, and derive `maxTokens` heuristically from `context_length`, `max_context_tokens`, `max_tokens`, or fall back to 128000. Rationale: OpenAI-compatible servers vary slightly but always expose an `id`. A liberal parser keeps the feature usable without provider-specific code. Date/Author: 2025-11-10 / Codex agent.

Decision: Treat provider API keys as optional—only attach the `Authorization` header when users actually supply a key. Rationale: Local/self-hosted endpoints (e.g., Ollama) intentionally run without authentication, and forcing a key prevented discovery; providers that require auth will return 401s naturally. Date/Author: 2025-11-10 / Codex agent.


## Outcomes & Retrospective

All milestones are complete: providers now persist a `modelSource` flag (plus migration), the new `src/ai/modelDiscoveryService.ts` handles provider-native `/v1/models` discovery with models.dev fallback and unit tests, and the provider editor UI/doc copy reflects the new dropdown plus synced behavior. Lint, tests, and production build all pass as of 2025-11-10. Remaining limitation: only Bearer-style auth is supported; future work could add per-provider header customization if needed by nonstandard endpoints.


## Context and Orientation


QuickAdd’s AI providers live under `src/ai/`. `src/ai/Provider.ts` declares the `AIProvider` interface plus defaults. `src/ai/modelsDirectory.ts` still fetches the models.dev catalog and maps endpoints to vendor keys, while `src/ai/modelDiscoveryService.ts` now centralizes discovery logic so callers can use provider-native `/v1/models` lists with an optional models.dev fallback. UI for editing providers sits in `src/gui/AIAssistantProvidersModal.ts`, which opens `ModelDirectoryModal` (`src/gui/ModelDirectoryModal.ts`) for browsing/importing models and exposes the “Auto-sync” feature. Provider settings are persisted through `settingsStore` (`src/settingsStore.ts`) and surfaced in `DEFAULT_SETTINGS` within `src/quickAddSettingsTab.ts`. Docs describing AI Assistant workflows live in `docs/docs/AIAssistant.md`. Tests targeting provider behavior currently reside under `src/` (for example `src/ai/modelDiscoveryService.test.ts`).


## Plan of Work


### Milestone 1 – Add discovery mode plumbing and migrations


Explain why the feature matters from the data layer outward. Extend `AIProvider` (`src/ai/Provider.ts`) to include a `modelSource: "modelsDev" | "providerApi" | "auto"` field. Update `DefaultProviders` to specify the most sensible defaults (OpenAI/Gemini: `modelsDev` for now). Ensure new custom providers created in `ProviderPickerModal` (`src/gui/ProviderPickerModal.ts`) initialize `modelSource` to `"providerApi"` so newly added endpoints immediately try `/v1/models`. Add a migration in `src/migrations/` (e.g., `setProviderModelDiscoveryMode.ts`) that iterates `settingsStore.getState().ai.providers`, sets missing `modelSource` fields based on endpoint heuristics (OpenAI/OpenRouter -> `auto`, Gemini -> `modelsDev`, unknown -> `providerApi`), and bumps the settings state. Wire this migration into `src/migrations/migrate.ts`. Update `DEFAULT_SETTINGS` to ensure fresh installs include the new field. Acceptance for this milestone: serializing settings to disk and reloading should preserve `modelSource` without undefined entries.


### Milestone 2 – Implement unified discovery service


Create a new module (e.g., `src/ai/modelDiscoveryService.ts`) that exports:

`ModelDiscoveryMode` type, currently defined in `Provider.ts`.
`discoverProviderModels(provider: AIProvider): Promise<Model[]>` as the public entry point.

Add internals:

`fetchViaModelsDev(provider)` reuses the existing directory logic (import `fetchModelsDevDirectory`, `mapModelsDevToQuickAdd`, `mapEndpointToModelsDevKey`).
`fetchViaProviderApi(provider)` that:
  1. Validates `provider.apiKey` unless `settingsStore.disableOnlineFeatures` is true (then throw a descriptive error).
  2. Normalizes the endpoint so `https://api.example.com` and `https://api.example.com/` both work.
  3. Calls `${base.replace(/\/$/, "")}/v1/models` via `requestUrl`, passing headers `Authorization: Bearer ${apiKey}`.
  4. Accepts JSON responses shaped like `{ data: ModelEntry[] }`, `{ object: "list", data: ModelEntry[] }`, or `ModelEntry[]`.
  5. Converts each entry into QuickAdd’s `Model` by reading `entry.id` (fall back to `entry.name`), deriving `maxTokens` from `context_length`, `max_context_tokens`, `max_tokens`, or fallback 128000.
  6. Ignores entries missing an `id`, logging a warning.

`discoverProviderModels` switches on `provider.modelSource`: `modelsDev` → models.dev fetch; `providerApi` → provider fetch; `auto` → provider fetch with a catch that falls back to models.dev when the endpoint host maps via `mapEndpointToModelsDevKey`, otherwise rethrow with context.

Add unit tests in `src/ai/modelDiscoveryService.test.ts` (Vitest already scans `src/**`) that mock `requestUrl` and assert provider API responses map correctly, errors are descriptive, auto mode falls back when appropriate, base URLs ending with `/v1` are respected, and providers without API keys still work. Milestone acceptance: `bun run test -- src/ai/modelDiscoveryService.test.ts` passes, demonstrating parser and fallback behavior.


### Milestone 3 – Update UI flows, docs, and validation


1. Provider editor UI (`src/gui/AIAssistantProvidersModal.ts`): add a “Model source” dropdown describing the options; bind to `provider.modelSource`. Update the “Import models” and “Auto-sync” descriptions/buttons to mention the active source and use `discoverProviderModels` when synchronizing.

2. ModelDirectoryModal (`src/gui/ModelDirectoryModal.ts`): replace `fetchModelsDevDirectory()` with `discoverProviderModels(provider)` so it fetches once, works with `Model[]`, and surfaces errors from provider APIs. Adjust the rendered rows to read `model.name` and `model.maxTokens` rather than models.dev-specific fields.

3. Auto-sync logic: ensure any legacy references to the models.dev helpers now route through the new discovery service so the entire UI respects the chosen source.

4. Docs (`docs/docs/AIAssistant.md`): update the “Browse models” section to explain provider-native discovery, describe the new dropdown, and outline when to choose each mode.

5. Tests: if existing tests assume a particular models.dev flow, update them. Add regression coverage ensuring `discoverProviderModels` gets invoked when the auto-sync toggle runs.

Milestone acceptance: manual QuickAdd run where a custom provider set to “Provider /v1/models” loads its catalog via “Browse models,” while built-in providers still work with models.dev. `bun run lint`, `bun run test`, and `bun run build` succeed.


## Concrete Steps


1. From `/Users/christian/Developer/quickadd`, run `bun run test` before edits to capture the baseline (expect pass).
2. Complete Milestone 1 edits, then rerun targeted tests if they exist for provider defaults.
3. Implement Milestone 2 plus its unit tests, running `bun run test -- src/ai/modelDiscoveryService.test.ts`.
4. Complete Milestone 3 UI/doc updates, then run the full suite: `bun run lint`, `bun run test`, `bun run build`.


## Validation and Acceptance


Manual validation: build QuickAdd, configure a provider pointing at an OpenAI-compatible endpoint, set model source to “Provider /v1/models,” and open “Browse models.” The modal should list entries pulled from that endpoint even if models.dev lacks the provider. Switch to “Automatic” and confirm fallback to models.dev when the provider API fails but the endpoint host maps to a models.dev entry.

Automated validation: `bun run test` must pass, including the new `src/ai/modelDiscoveryService.test.ts`. Build validation: `bun run build` succeeds to ensure TypeScript and bundling remain healthy.

Optional live validation (off by default): run `LIVE_DISCOVERY_TESTS=1 OPENROUTER_API_KEY=<key> bun run test -- src/ai/modelDiscoveryService.live.test.ts` to hit real Ollama and OpenRouter endpoints. Tests remain skipped unless `LIVE_DISCOVERY_TESTS` is set.


## Idempotence and Recovery


The new migration must check for existing `modelSource` fields so reruns are no-ops. `discoverProviderModels` is read-only; failures surface as notices without mutating provider configs, so users can retry. Auto-sync still deduplicates models via `dedupeModels`, so repeated imports are safe. If a provider lacks `/v1/models`, users can switch its model source back to models.dev.


## Artifacts and Notes


Sample `/v1/models` payloads to reference while implementing the parser:

    {
      "data": [
        { "id": "gpt-4o", "context_length": 128000 },
        { "id": "meta-llama/llama-3.1-8b-instruct", "max_context_tokens": 8192 }
      ]
    }

    [
      { "id": "custom-proto", "max_tokens": 4096 },
      { "name": "backup-model", "context_length": 16384 }
    ]

Ensure the parser handles both shapes and uses `name` when `id` is missing.


## Interfaces and Dependencies


Extend `src/ai/Provider.ts`:

    export type ModelDiscoveryMode = "modelsDev" | "providerApi" | "auto";

    export interface AIProvider {
        ...
        modelSource: ModelDiscoveryMode;
    }

Add `src/ai/modelDiscoveryService.ts`:

    export async function discoverProviderModels(provider: AIProvider): Promise<Model[]>;

    async function fetchViaProviderApi(provider: AIProvider): Promise<Model[]>;

    async function fetchViaModelsDev(provider: AIProvider): Promise<Model[]>;

All UI code should import `discoverProviderModels` rather than reading models.dev directly. Depend only on `requestUrl`, `settingsStore`, and helpers like `dedupeModels`. Document each function with concise JSDoc so future contributors know when to use each mode.


Note: This initial ExecPlan revision was authored on 2025-11-10 to address issue #969 by adding provider-native model discovery. Update this note whenever significant plan revisions occur, including the rationale for each change. Revision 2025-11-10 19:05Z: logged completion of `modelSource` plumbing plus migration scaffolding and clarified remaining backend work. Revision 2025-11-10 19:07Z: reorganized Progress entries so milestone tracking maps 1:1 with the ExecPlan. Revision 2025-11-10 19:25Z: documented that discovery service + tests are in place and updated the test location to `src/ai` to match Vitest’s include rules. Revision 2025-11-10 19:40Z: recorded completion of the UI/docs milestone and validation runs.
