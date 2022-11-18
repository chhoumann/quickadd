---
title: Macros
---

Macros are powerful tools that allow you to execute any sequence of Obsidian commands and user scripts.
User scripts are Javascript scripts that you can write to do something in Obsidian. All you need is a Javascript file in your vault, and you can activate it.

Each _macro choice_ has an associated _macro_. A macro choice allows you to activate a macro from the QuickAdd suggester.

This is what the settings for a _macro choice_ looks like.

![image](https://user-images.githubusercontent.com/29108628/121774145-22ccd100-cb81-11eb-8873-7533755bdf32.png)

Now, you can have any amount of _macros_. You can use the macro manager to... manage them.
If you have any macros that you want to run on plugin load - which is often just when you start Obsidian - you can specify that here, too.

This allows you to, for example, create a daily note automatically when you open Obsidian.

![image](https://user-images.githubusercontent.com/29108628/121774198-81924a80-cb81-11eb-9f80-9816263e4b6f.png)

This is what my `logBook` macro looks like. It's pretty plain - it just executes one of my user scripts.

![image](https://user-images.githubusercontent.com/29108628/121774245-cfa74e00-cb81-11eb-9977-3ddac04dc8bd.png)

The `logBook` user script simply updates the book in my daily page to something I specify in a prompt.
Here it is - with some comments that explain the code. [How-to-install guide](https://github.com/chhoumann/quickadd/issues/15#issuecomment-864553251).

```js
// You have to export the function you wish to run.
// QuickAdd automatically passes a parameter, which is an object with the Obsidian app object
// and the QuickAdd API (see description further on this page).
module.exports = async (params) => {
	// Object destructuring. We pull inputPrompt out of the QuickAdd API in params.
	const {
		quickAddApi: { inputPrompt },
	} = params;
	// Here, I pull in the update function from the MetaEdit API.
	const { update } = app.plugins.plugins["metaedit"].api;
	// This opens a prompt with the header "📖 Book Name". val will be whatever you enter.
	const val = await inputPrompt("📖 Book Name");
	// This gets the current date in the specified format.
	const date = window.moment().format("gggg-MM-DD - ddd MMM D");
	// Invoke the MetaEdit update function on the Book property in my daily journal note.
	// It updates the value of Book to the value entered (val).
	await update("Book", val, `bins/daily/${date}.md`);
};
```

Any function executed by QuickAdd will be passed an object as the first (and only) parameter.
The object contains

-   A reference to the Obsidian `app`.
-   A reference to the QuickAddApi - which allows you to use the functions below.
-   A reference to `variables`, an object which, if you assign values to it, you can use in your format syntax.

Let's talk a bit more about `variables`. If you assign a value to a key in `variables`, you can access that variable by its key name.
This can be accessed both in subsequent macros, and the format syntax `{{VALUE:<variable name>}}`.

For example, say you assign `myVar` to `variables`.
Then you can access the value of `myVar` in subsequent macros, as well as through the format syntax`{{VALUE:myVar}}`.
You can also access it through `<parametername>.variables["myVar"]`.

```js
// MACRO 1
module.exports = (params) => {
	params.variables["myVar"] = "test";
};

// MACRO 2
module.exports = (params) => {
	console.log(params.variables["myVar"]);
};
```

You can use variables to pass parameters between user scripts.

In your user scripts for your macros, you can have use `module.exports` to export a function, which will be executed as expected.

You can, however, export much more than functions. You can also export variables - and more functions!

```js
// Macro called 'MyMacro'
module.exports = {
	myVar: "test",
	plus: (params) => params.variables["a"] + params.variables["b"],
	start,
};

async function start(params) {
	params.app.vault.doSomething();
	const input = await params.quickAddApi.suggester(
		["DisplayValue1", "DisplayValue2", "DisplayValue3"],
		["ActualValue1", "ActualValue2", "ActualValue3"]
	);
	return input;
}
```

If you select the macro that contains a user script with the above code, you'll be prompted to choose between one of the three exported items.

However, if you want to skip that, you can access nested members using this syntax: `{{MACRO:MyMacro::Start}}`. This will just instantly execute `start`.
