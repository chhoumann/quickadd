# Contributing to QuickAdd

Thanks for wanting to contribute to QuickAdd. The best way to start is to use
the plugin, get familiar with how people use it, and look through existing
issues or discussions for something concrete to improve.

If you already know what you want to change, open a focused pull request with a
clear explanation of the problem, the fix, and how you validated it. If you are
not sure whether an idea fits the project, please ask first by opening an issue
or starting a discussion.

## Before you open a pull request

- Contribute as a user of the plugin. QuickAdd welcomes PRs from people who use
  it and take part in the community. PRs from accounts with no prior interaction
  here are likely to be closed.
- Claim the issue first: comment on it and wait for a maintainer go-ahead before
  writing code.
- AI assistance is fine - plenty of good contributions are AI-assisted. But if a
  PR is purely AI-generated, with no prior interaction and nothing human-written
  in it, it's likely not going to be accepted. Show that some human thought went
  into what you're submitting. Review the result yourself; do not send
  maintainers code you have not read.
- Describe how the change was verified in a real Obsidian vault - include the
  commands you ran, the Obsidian version or dev vault flow you used, and
  screenshots for UI changes.

## Development

QuickAdd uses `pnpm` for local development tasks.

```bash
pnpm install
pnpm run dev    # rebuild main.js on every change
pnpm run test   # unit tests
pnpm run build  # type-check and bundle
```

For changes that affect the plugin at runtime, verify the behavior in Obsidian
as well as with automated tests. When working with the local dev vault, use the
`obsidian` CLI with the `dev` vault prefix:

```bash
obsidian vault=dev plugin:reload id=quickadd
```

Keep pull requests narrow. Include generated files such as `main.js` and
`styles.css` when the source change updates them.

### Obsidian's plugin review

Obsidian reviews each release with ESLint (`eslint-plugin-obsidianmd`) and
Stylelint. `pnpm run lint` fails on the review's code checks that QuickAdd
passes: floating promises, deprecated APIs, static inline styles, and
`new Function`. A kept exception needs a lint comment or config entry that says
why.

The CSS checks (`!important`, `:has()`, and CSS that Obsidian 1.13.0's Electron
lacks) and the full review run only in Obsidian's own
[workflow action](https://github.com/obsidianmd/obsidian-workflows). Run it on
your checkout when you change `src/styles.css` or a component's styles. It also
lists findings QuickAdd accepts, such as `no-unsafe-*` and the command IDs that
hotkeys depend on. A built `styles.css` at the root is linted as well, so run it
before building or delete that file first.

```bash
git clone -q -c advice.detachedHead=false --depth 1 --branch v1 \
  https://github.com/obsidianmd/obsidian-workflows /tmp/obsidian-workflows
set -o pipefail
env GITHUB_WORKSPACE="$PWD" GITHUB_STEP_SUMMARY=/dev/null INPUT_TYPE=plugin \
  INPUT_MODE=pr INPUT_BUILD=false INPUT_LINT=true INPUT_SCANNER-LINT=true \
  node /tmp/obsidian-workflows/dist/index.js | awk '/^::warning/'
```

### End-to-end tests

`pnpm run test:e2e` runs tests against a real Obsidian app. It needs Obsidian
installed and the `obsidian` CLI on `PATH`. Each worktree gets its own vault and
Obsidian instance, so the tests never touch your own vaults:

```bash
eval "$(pnpm run --silent start:e2e-obsidian -- --print-env)"
export HOME="$OBSIDIAN_E2E_OBSIDIAN_HOME"
pnpm run test:e2e
pnpm run stop:e2e-obsidian
```

Failed runs write artifacts to `.obsidian-e2e-artifacts/`. For ad hoc commands
against the isolated instance, such as `pnpm run obsidian:e2e -- quickadd:list`,
see the Obsidian runtime workflow in [AGENTS.md](AGENTS.md).
