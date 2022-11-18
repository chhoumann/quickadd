### Template
The template choice type is not meant to be a replacement for Templater or core Templates. It's meant to augment them. You can use both QuickAdd format syntax in a Templater template - and both will work.
That's one thing. But there's also all the other options: dynamic template names, adding to folders, appending links, incrementing file names, opening the file when it's created (or not), etc.

You first need to specify a _template path_. This is a path to the template you wish to insert.

The remaining settings are useful, but optional. You can specify a format for the file name, which is based on the format syntax - which you can see further down this page.
Basically, this allows you to have dynamic file names. If you wrote `{ {{DATE}} {{NAME}}`, it would translate to a file name like `{ 2021-06-12 FileName`, where `FileName` is a value you enter.

You can specify as many folders as you want. If you don't, it'll just create the file in the root directory. If you specify one folder, it'll create the file in there.
If you specify multiple folders, you'll be asked which folder you wish to create the file in when you are creating it.

_Append link_ appends a link to the created file in the file you're currently in.

_Increment file name_ will, if a file with that name already exists, increment the file name. So if a file called `untitled` already exists, the new file will be called `untitled1`.

_Open_ will open the file you've created. By default, it opens in the active pane. If you enable _New tab_, it'll open in a new tab in the direction you specified.
![image](https://user-images.githubusercontent.com/29108628/121773888-3f680980-cb7f-11eb-919b-97d56ef9268e.png)
