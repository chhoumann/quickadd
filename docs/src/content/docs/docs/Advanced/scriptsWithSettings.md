---
title: Scripts with user settings
description: Give a user script configurable fields - text, secret, checkbox, dropdown, and format - so anyone can set it up from the QuickAdd UI without touching the code
slug: docs/Advanced/scriptsWithSettings
---

A script with settings puts configurable fields right in QuickAdd's UI, so
anyone can set it up - an API key, a folder path, an on/off toggle - without
editing the JavaScript. You write the script once and expose the parts that
should change; everyone else fills in a form.

Any script with settings gets a gear (⚙️) button next to its name in a macro.
Click it to open that script's settings menu. For a real-world example, see the
[Movies](/docs/Examples/Macro_MovieAndSeriesScript/) macro.

## Add settings to a script {#creating-a-script-with-settings}

Instead of exporting a plain function, export an **object** with two properties:
`entry` (the function that runs) and `settings` (what to show in the UI).

```js
const TEXT_FIELD = "Text field";

module.exports = {
    entry: async (QuickAdd, settings) => {
        // Logic here
        const textFieldSettingValue = settings[TEXT_FIELD];
    },
    settings: {
        name: "Demo",
        author: "Christian B. B. Houmann",
        options: {
            [TEXT_FIELD]: {
                type: "text",
                defaultValue: "",
                placeholder: "Placeholder",
                description: "Description here.",
            },
            "API Key": {
                type: "secret",
                id: "api-key",
                placeholder: "Paste API key",
                description: "Stored securely with Obsidian SecretStorage.",
            },
            "Checkbox": {
                type: "checkbox",
                defaultValue: false,
            },
            "Dropdown": {
                type: "dropdown",
                defaultValue: "Option 1",
                options: [
                    "Option 1",
                    "Option 2",
                    "Option 3",
                ],
            },
            "Format": {
                type: "format",
                defaultValue: "{{DATE:YYYY-MM-DD}}",
                placeholder: "Placeholder",
            },
        }
    },
};
```

This script's settings menu shows a text field, a secret API-key field, a
checkbox, a dropdown, and a format field - one per entry in `options`:

![Settings menu for the script](../Images/script_with_settings.png)

How the pieces fit together:

- **`entry`** runs when the script executes. It receives two arguments: the
  `QuickAdd` object (the same thing passed to any
  [script in a macro](/docs/Choices/MacroChoice/)) and `settings`, an object
  holding the values the user set. The argument names are up to you.
- **`settings.name`** and **`settings.author`** are shown in the settings menu.
- **`settings.options`** defines the fields. Each key is the setting's name (and
  how you read its value back, like `settings["Text field"]`); each value is an
  object describing the field. Add a `description` to any field to show help
  text beneath it.

## The field types {#setting-types}

Set each field's `type` to one of these:

- `text` and `input`: A text field.
- `secret`: A password-style input stored with Obsidian SecretStorage. QuickAdd stores only a reference in `data.json`; package exports omit secret values and local secret references. Add an optional `id` to give the stored secret a stable key if the visible setting label changes later. The older `text` / `input` plus `secret: true` form is still treated as a secret setting.
- `textarea`: A multi-line text area.
- `checkbox` and `toggle`: A checkbox.
- `dropdown` and `select`: A dropdown.
- `format`: A format field, adhering to [format syntax](/docs/FormatSyntax/).
