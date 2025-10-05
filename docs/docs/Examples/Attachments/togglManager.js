let togglApi;
let quickAddApi;
let projects;

const back = "<- Back";
const menu = {
	"🧠 Learning & Skill Development": {
		togglProjectName: "Learning & Skill Development",
		menuOptions: {
			"✍ Note Making": "Note Making",
			"🃏 Spaced Repetition": "Spaced Repetition",
			"📖 Read Later Processing": "Read Later Processing",
			"👨‍💻 Computer Science & Software Engineering":
				"Computer Science & Software Engineering",
		},
	},
	"🤴 Personal": {
		togglProjectName: "Personal",
		menuOptions: {
			"🏋️‍♂️ Exercise": "Exercise",
			"🧹 Chores": "Chores",
			"👨‍🔬 Systems Work": "Systems Work",
			"🌀 Weekly Review": "Weekly Review",
			"📆 Monthly Review": "Monthly Review",
			"✔ Planning": "Planning",
		},
	},
	"👨‍🎓 School": {
		togglProjectName: "School",
		menuOptions: {
			"🧠 Machine Intelligence (MI)": "Machine Intelligence (MI)",
			"💾 Database Systems (DBS)": "Database Systems (DBS)",
			"🏃‍♂ Agile Software Engineering (ASE)":
				"Agile Software Engineering (ASE)",
			"💻 P5": "P5",
		},
	},
};

module.exports = async function togglManager(params) {
	togglApi =
		params.app.plugins.plugins["obsidian-toggl-integration"].toggl._apiManager;
	quickAddApi = params.quickAddApi;
	projects = await togglApi.getProjects();

	openMainMenu(menu);
};

const _dateInSeconds = (date) => {
	return Math.floor(date / 1000);
};

async function startTimer(entryName, projectID) {
	await togglApi.startTimer({ description: entryName, pid: projectID });
}

async function openMainMenu(menu) {
	const { suggester } = quickAddApi;
	const options = Object.keys(menu);

	const choice = await suggester(options, options);
	if (!choice) return;

	const project = menu[choice];
	await openSubMenu(project);
}

async function openSubMenu(project) {
	const { suggester } = quickAddApi;
	const options = [...Object.keys(project.menuOptions), back];

	const choice = await suggester(options, options);
	if (!choice) return;

	if (choice === back) {
		return await openMainMenu(menu);
	}

	const entryName = project.menuOptions[choice];
	const projectID = projects.find(
		(p) => p.name === project.togglProjectName
	).id;

	startTimer(entryName, projectID);
}
