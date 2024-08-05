---
title: Open QuickAdd from a URI
---

QuickAdd choices can be launched from external scripts or apps such as Shortcuts on Mac and iOS, through the use of the `obsidian://quickadd` URI.

```
obsidian://quickadd?choice=<YOUR_CHOICE_NAME>[&value-VALUE_NAME=...]
```

:::note

All parameter names and values must be properly [URL encoded](https://en.wikipedia.org/wiki/Percent-encoding) to work. You can use an online tool like [urlencoder.org](https://www.urlencoder.org/) to help you easily encode parts of the URI.

:::

The only required parameter is `choice` which selects the choice to run by its name. The name must match exactly, otherwise it will not be able to be found.

[Variables to your choice](../FormatSyntax.md) are passed as additional `value-VARIABLE_NAME` parameters, with `value-` prefixing the name. Variables with a space in their name can still be used, but the spaces in the name must be encoded as `%20` as usual. For example, a capture asking for a variable named `log notes` would be passed as `value-log%20notes=...` in the URI.

Keep in mind that unnamed variables (a bare `{{VALUE}}`/`{{NAME}}` or `{{MVALUE}}`) cannot be filled by the URI and you will instead be prompted inside Obsidian as usual.

## Vault parameter

Like every Obsidian URI, you can use the special `vault` parameter to specify which vault to run QuickAdd in. If left blank, it will be executed in your most recent vault.

```
obsidian://quickadd?vault=My%20Vault&choice=Daily%20log&value-contents=Lorem%20ipsum.
```
