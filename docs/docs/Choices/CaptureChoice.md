---
title: Capture
---

![image](https://user-images.githubusercontent.com/29108628/123451366-e025e280-d5dd-11eb-81b6-c21f3ad1823d.png)
![image](https://user-images.githubusercontent.com/29108628/123451469-e61bc380-d5dd-11eb-80d1-7667427656f3.png)

## Capture To
_Capture To_ is the name of the file you are capturing to.
You can choose to either enable _Capture to active file_, or you can enter a file name in the _File Name_ input field.

This field also supports the [format syntax](/FormatSyntax.md), which allows you to use dynamic file names.
I have one for my daily journal with the name `bins/daily/{{DATE:gggg-MM-DD - ddd MMM D}}.md`.
This automatically finds the file for the day, and whatever I enter will be captured to it.

### Capturing to folders
You can also type a **folder name** into the _Capture To_ field, and QuickAdd will ask you which file in the folder you'd like to capture to.
This also supports the [format syntax](/FormatSyntax.md). You can even write a filename in the suggester that opens, and it will create the file for you - assuming you have the _Create file if it doesn't exist_ setting enabled.

For example, you might have a folder called `CRM/people`. In this folder, you have a note for the people in your life. You can type `CRM/people` in the _Capture To_ field, and QuickAdd will ask you which file to capture to. You can then type `John Doe` in the suggester, and QuickAdd will create a file called `John Doe.md` in the `CRM/people` folder.

You could also write nothing - or `/` - in the _Capture To_ field. This will open the suggester with all of your files in it, and you can select or type the name of the file you want to capture to.

Capturing to a folder will show all files in that folder. This means that files in nested folders will also appear.

### Capturing to tags
Similarly, you can type a **tag name** in the _Capture To_ field, and QuickAdd will ask you which file to capture to, assuming the file has the tag you specify.

If you have a tag called `#people`, and you type `#people` in the _Capture To_ field, QuickAdd will ask you which file to capture to, assuming the file has the `#people` tag.


## Capture Options
-   _Create file if it doesn't exist_ will do as the name implies - you can also create the file from a template, if you specify the template (the input box will appear below the setting).
-   _Task_ will format your captured text as a task.
-   _Write to bottom of file_ will put whatever you enter at the bottom of the file.
-   _Append link_ will append a link to the file you have open in the file you're capturing to.

## Insert after
Insert After will allow you to insert the text after some line with the specified text.

With Insert After, you can also enable `Insert at end of section` and `Consider subsections`.
You can see an explanation of these below.

I use this in my journal capture, where I insert after the line `## What did I do today?`.

### Consider subsections
Behavior with `Insert after` & `Insert at end`, but not `Consider subsections` enabled:
```markdown
## Heading # Insert after here
- content 1
- content 2
- content 3 # captures to after this = same behavior as before. Enabled by default.

### Nested heading 1
Content

## Another heading
Content

```

New behavior with `Insert after`, `Insert at end`, AND `Consider subsections` enabled:
```markdown
## Heading # Insert after here
- content 1
- content 2
- content 3

### Nested heading 1
Content # captures to after this, as it's considered part of the "## Heading" section

## Another heading
Content

```

## Capture Format
Capture format lets you specify the exact format that you want what you're capturing to be inserted as.
You can do practically anything here. Think of it as a mini template.

If you do not enable this, QuickAdd will default to `{{VALUE}}`, which will just insert whatever you enter in the prompt that appears when activating the Capture.

You can use [format syntax](/FormatSyntax.md) here, which allows you to use dynamic values in your capture format.

In my journal capture, I have it set to `- {{DATE:HH:mm}} {{VALUE}}`. This inserts a bullet point with the time in hour:minute format, followed by whatever I entered in the prompt.