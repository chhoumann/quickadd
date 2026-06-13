# Contributing to QuickAdd

Thanks for wanting to contribute to QuickAdd. The best way to start is to use
the plugin, get familiar with how people use it, and look through existing
issues or discussions for something concrete to improve.

If you already know what you want to change, open a focused pull request with a
clear explanation of the problem, the fix, and how you validated it. If you are
not sure whether an idea fits the project, please ask first by opening an issue
or starting a discussion.

AI-assisted contributions are welcome, but please review the result yourself
before submitting it. Do not send maintainers code you have not read. At a
minimum, validate that the change works on your machine and include evidence in
the pull request, such as the commands you ran, the Obsidian version or dev
vault flow you used, and any relevant screenshots for UI changes.

## Development

QuickAdd uses `pnpm` for local development tasks.

```bash
pnpm run test
pnpm run build
```

For changes that affect the plugin at runtime, verify the behavior in Obsidian
as well as with automated tests. When working with the local dev vault, use the
`obsidian` CLI with the `dev` vault prefix:

```bash
obsidian vault=dev plugin:reload id=quickadd
```

Keep pull requests narrow. Include generated files such as `main.js` and
`styles.css` when the source change updates them.
