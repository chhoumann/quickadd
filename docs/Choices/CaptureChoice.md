### Capture
_Capture To_ is the name of the file you are capturing to. 
You can choose to either enable _Capture to active file_, or you can enter a file name in the _File Name_ input field.

This field also supports the [format syntax](../FormatSyntax.md), which allows you to use dynamic file names.
I have one for my daily journal with the name `bins/daily/{{DATE:gggg-MM-DD - ddd MMM D}}.md`.
This automatically finds the file for the day, and whatever I enter will be captured to it.

- _Create file if it doesn't exist_ will do as the name implies - you can also create the file from a template, if you specify the template (the input box will appear below the setting).
- _Prepend_ will put whatever you enter at the bottom of the file.
- _Task_ will format it as a task.
- _Append link_ will append a link to the file you have open in the file you're capturing to.
- _Insert after_ will allow you to insert the text after some line with the specified text. I use this in my journal capture, where I insert after the line `## What did I do today?`.

_Capture format_ lets you specify the exact format that you want what you're capturing to be inserted as. You can do practically anything here. Think of it as a mini template.
See the format syntax further down on this page for inspiration.
In my journal capture, I have it set to `- {{DATE:HH:mm}} {{VALUE}}`. This inserts a bullet point with the time in hour:minute format, followed by whatever I entered in the prompt.

![image](https://user-images.githubusercontent.com/29108628/123451366-e025e280-d5dd-11eb-81b6-c21f3ad1823d.png)
![image](https://user-images.githubusercontent.com/29108628/123451469-e61bc380-d5dd-11eb-80d1-7667427656f3.png)
