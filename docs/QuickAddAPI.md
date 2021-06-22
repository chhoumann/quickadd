## QuickAdd API
### `inputPrompt(header: string, placeholder?: string, value?: string): string`
Opens a prompt that asks for an input. Returns a string with the input.

### `yesNoPrompt: (header: string, text?: string): boolean`
Opens a prompt asking for confirmation. Returns `true` or `false` based on answer.

### `suggester: (displayItems: string[], actualItems: string[])`
Opens a suggester. Displays the `displayItems`, but you map these the other values with `actualItems`.

Returns the selected value.

### `checkboxPrompt: (items: string[], selectedItems: string[])`
Opens a checkbox prompt with the items given. Items in the `selectedItems` array will be selected by default.

Returns an array of the selected items.
