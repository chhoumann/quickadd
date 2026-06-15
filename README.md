<p align="center">
  <img src="assets/quickadd-logo.png" alt="QuickAdd for Obsidian" width="520" />
</p>

QuickAdd is a powerful combination of four tools (called choices): templates, captures, macros, and multis.

A [**Template**](https://quickadd.obsidian.guide/docs/Choices/TemplateChoice) is a definition of how to create a new note, and composes with Obsidian's own Templates core plugin or community template plugins. For example, it would allow you to define a quick action to create a new note in a particular location, with a templatized title, and templated content.

A [**Capture**](https://quickadd.obsidian.guide/docs/Choices/CaptureChoice) allows you to quickly add content to predefined files. For example, you could set up a quick action to add a link to the open file to your daily note under a specific section.

[**Macros**](https://quickadd.obsidian.guide/docs/Choices/MacroChoice) will allow you to compound these two together into powerful chained workflows. Imagine pressing one hotkey to automatically create a new note to track a chess match with a specific template, while automatically adding a reference to it in your "list of matches" note and in your daily note.

[Multi choices](https://quickadd.obsidian.guide/docs/Choices/MultiChoice) are purely organisational: folders of other choices.

Throughout your choices, you can use the [QuickAdd format syntax](https://quickadd.obsidian.guide/docs/FormatSyntax), which is similar to the Obsidian template syntax. You could, for example, use ``{{DATE}}`` to insert the current date in a filename.

### Demo video
[![Demo video](https://img.youtube.com/vi/gYK3VDQsZJo/0.jpg)](https://www.youtube.com/watch?v=gYK3VDQsZJo)

## Installation

QuickAdd can be installed through the community plugin browser in Obsidian, or through manual installation. See the [installation documentation](https://quickadd.obsidian.guide/docs/#installation) for more information.

## Getting Started

For detailed instructions and examples on using QuickAdd, see the [QuickAdd documentation](https://quickadd.obsidian.guide/).

## Development

QuickAdd uses `pnpm` for local development tasks:

- `pnpm run test` runs the unit test suite.
- `pnpm run build` type-checks and bundles the plugin.
- `pnpm run test:e2e` runs Obsidian-backed end-to-end tests.

The E2E suite is local-only today. It depends on a locally installed Obsidian
app and the `obsidian` CLI being available on `PATH`. By default it targets the
`dev` vault, but the target is configurable:

```bash
pnpm run provision:e2e-vault -- --vault quickadd-my-worktree --register-via dev --print-env
export QUICKADD_E2E_VAULT='quickadd-my-worktree'
export QUICKADD_E2E_VAULT_PATH='/absolute/path/from/printed/output'
pnpm run test:e2e
```

`provision:e2e-vault` creates an isolated Obsidian vault under
`.obsidian-e2e-vaults/` and symlinks QuickAdd's `manifest.json`, `main.js`, and
`styles.css` from the selected worktree. Pass `--worktree /path/to/worktree` to
provision a vault for another checkout. `--register-via dev` asks the running
Obsidian app to register the new vault through the already-addressable `dev`
vault, disables Restricted Mode for the provisioned vault, and waits until
`quickadd:list` works. Omit it if you only want to prepare the vault directory.
When `QUICKADD_E2E_VAULT_PATH` is set, the tests verify that the Obsidian CLI
resolved `QUICKADD_E2E_VAULT` to that exact directory before they mutate the
vault.

For worktree-local Obsidian runtime isolation, use:

```bash
pnpm run obsidian:e2e -- quickadd:list
pnpm run obsidian:e2e -- dev:errors
pnpm run obsidian:e2e -- eval code='app.vault.getName()'
```

`obsidian:e2e` prepares the worktree-local vault, starts or reuses an isolated
Obsidian app instance, disables Restricted Mode for that vault, waits until
`quickadd:list` succeeds, and then forwards the requested command to the
`obsidian` CLI with the isolated `HOME` and `vault=<worktree vault>` already
set. Use this wrapper for ad hoc Obsidian CLI work in Codex worktrees instead of
hand-exporting `QUICKADD_E2E_*` variables for every command.

To run the lower-level setup manually:

```bash
pnpm run start:e2e-obsidian -- --vault quickadd-my-worktree --print-env
export QUICKADD_E2E_VAULT='quickadd-my-worktree'
export QUICKADD_E2E_VAULT_PATH='/absolute/path/from/printed/output'
export QUICKADD_E2E_OBSIDIAN_HOME='/absolute/path/from/printed/output'
pnpm run test:e2e
```

`start:e2e-obsidian` creates a private Obsidian `HOME` under
`/tmp/quickadd-obsidian-e2e/`, launches a separate Obsidian app instance with
that `HOME` and its own Electron `--user-data-dir`, waits until the CLI resolves
the provisioned vault through that instance's socket, disables Restricted Mode,
and waits until `quickadd:list` succeeds. Set the printed
`QUICKADD_E2E_OBSIDIAN_HOME` when running tests so `obsidian-e2e` talks to that
worktree's Obsidian instance instead of the shared desktop instance.

Failed E2E runs may write artifacts to `.obsidian-e2e-artifacts/`.

## Support

If you have any questions or encounter any problems while using QuickAdd, you can use the [community discussions](https://github.com/chhoumann/quickadd/discussions) for support.
