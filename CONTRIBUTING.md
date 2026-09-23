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
