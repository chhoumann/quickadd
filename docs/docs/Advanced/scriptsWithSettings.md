---
title: Scripts with user settings
---

QuickAdd supports scripts with settings. This allows you to create scripts that can be configured by the user.

Any script with settings will have a ⚙️ button next to the script name in a macro. Clicking the button will open a settings menu for the script.

As an example, see the [Movies](../Examples/Macro_MovieAndSeriesScript.md) macro.

## Creating a script with settings
A script with settings is a JavaScript file that exports an object with two properties: `entry` and `settings`.

The `entry` property is a function that is called when the script is executed. The function is passed two arguments: `QuickAdd` and `settings` (naming is up to you).
`QuickAdd` is an object containing the same as what is usually passed to [scripts in macros](../Choices/MacroChoice). `settings` is an object containing the settings for the script, as set by the user.

The `settings` property is an object containing the settings for the script. It has three properties: `name`, `author` and `options`.

`name` is the name of the script, as shown in the settings menu.

`author` is the author of the script, as shown in the settings menu.

`options` is an object containing the settings for the script. The keys are the names of the settings, and the values are objects containing the setup parameters for the setting.

For example, the following script will have a text field setting with the key `Text field`, a checkbox setting with the key `Checkbox`, a dropdown setting with the key `Dropdown` and a format setting with the key `Format`. This is shown in the image below.

![Settings menu for the script](../Images/script_with_settings.png)

It's possible to give a description to a setting by adding a `description` property to the setting object.

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

## Setting types
- `text` and `input`: A text field.
- `checkbox` and `toggle`: A checkbox.
- `dropdown` and `select`: A dropdown.
- `format`: A format field, adhering to [format syntax](../FormatSyntax.md).