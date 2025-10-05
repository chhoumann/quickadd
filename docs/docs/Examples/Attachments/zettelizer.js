module.exports = async (params) => {
	console.log("Starting...");
	console.log(params);
	const currentFile = params.app.workspace.getActiveFile();
	if (!currentFile) {
		new Notice("No active file.");
		return;
	}
	console.log("Found active file: ", currentFile.basename);

	const currentFileCache = params.app.metadataCache.getFileCache(currentFile);
	const headingsInFile = currentFileCache.headings;
	if (!headingsInFile) {
		new Notice(`No headers in file ${currentFile.name}`);
		return;
	}
	console.log("Found headings in active file: ", headingsInFile);

	const folder = "40 Slipbox/44 Zettels";
	if (!params.app.vault.adapter.exists(folder)) {
		new Notice(`Could not find folder ${folder}`);
		return;
	}

	console.log("Folder does exist: ", folder);

	headingsInFile.forEach(async (heading) => {
		console.log(`Checking ${heading.heading}. It is level ${heading.level}`);
		if (heading.level === 3) {
			const splitHeading = heading.heading.split(" ");
			const location = splitHeading[0].trim();
			const text =
				splitHeading.length > 1
					? [...splitHeading.slice(1)].join(" ").trim()
					: "";

			const path = `${folder}/${text.replace(/[\\,#%&{}/*<>$'":@]*/g, "")}.md`;
			const content = `![[${currentFile.basename}#${location}${text ? ` ${text}` : ""}]]`;

			console.log(`Path: ${path}.\nContent: ${content}`);

			if (text && !(await params.app.vault.adapter.exists(path)))
				await params.app.vault.create(path, content);
			else if (text) new Notice(`File ${path} already exists.`, 5000);
		}
	});

	console.log("Finished!");
};
