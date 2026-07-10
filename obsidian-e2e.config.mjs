// Consumer config for the shared obsidian-e2e instance runner. The four
// `provision:e2e-vault` / `start:e2e-obsidian` / `stop:e2e-obsidian` /
// `obsidian:e2e` scripts point at the `obsidian-e2e` bin, which reads this file
// from the worktree root. See the runner's README ("Instance Runner (CLI)") for
// the full schema.
//
// `defaultData` seeds a freshly provisioned vault's data.json. QuickAdd's real
// DEFAULT_SETTINGS (src/settings.ts) is large and churny - it embeds the full
// AI provider catalog (DefaultProviders, with per-model seed lists that get
// re-synced), a long default system prompt, and 15 migration flags. Seeding all
// of that would mean the seed and its drift test churn on every model-catalog
// update for no test value. Instead we seed the minimal shape the old vendored
// provision script used - `{ choices: [], migrations: {} }` - which emulates a
// clean install: no choices, and empty `migrations` so a fresh vault re-runs
// every migration on first load. tests/e2e-config.test.ts drift-tests just this
// subset against DEFAULT_SETTINGS (the seed keys stay valid, `choices` stays in
// sync); `migrations` is intentionally left empty rather than mirrored.
export default {
	pluginId: "quickadd",
	// QuickAdd ships a hand-written styles.css at the repo root alongside the
	// compiled main.js, so all three plugin artifacts are symlinked into the vault.
	pluginArtifacts: ["manifest.json", "main.js", "styles.css"],
	defaultData: {
		choices: [],
		migrations: {},
	},
	buildCommand: "pnpm run build",
	// The `run` subcommand's default: list QuickAdd's choices, the same default
	// the old vendored CLI used.
	defaultCommand: ["quickadd:list"],
	// Emit legacy QUICKADD_E2E_* env aliases alongside the canonical OBSIDIAN_E2E_*
	// names while the harness and AGENTS.md playbooks migrate off them.
	envPrefix: "QUICKADD",
	// Confirm the QuickAdd plugin instance is live in the target vault. Reuses the
	// old verify semantics: the launcher waits until `quickadd:list` reports
	// `"ok":true`, which only happens once the plugin's command is registered and
	// answering. The match string intentionally omits the surrounding JSON so an
	// echoed command can't be mistaken for a positive result.
	readyProbe: {
		kind: "command",
		args: ["quickadd:list"],
		match: '"ok":true',
	},
};
