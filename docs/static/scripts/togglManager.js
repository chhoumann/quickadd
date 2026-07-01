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
            "👨‍💻 Computer Science & Software Engineering": "Computer Science & Software Engineering",
        }
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
        }
    },
    "👨‍🎓 School": {
        togglProjectName: "School",
        menuOptions: {
            "🧠 Machine Intelligence (MI)": "Machine Intelligence (MI)",
            "💾 Database Systems (DBS)": "Database Systems (DBS)",
            "🏃‍♂ Agile Software Engineering (ASE)": "Agile Software Engineering (ASE)",
            "💻 P5": "P5",
        }
    }
};

module.exports = async function togglManager(params) {
    // Guard the plugin lookup (mirrors citationsManager.js): without it, a
    // missing/disabled Toggl integration throws an opaque TypeError here.
    const togglPlugin = params.app.plugins.plugins["obsidian-toggl-integration"];
    if (!togglPlugin || !togglPlugin.toggl || !togglPlugin.toggl._apiManager) {
        new Notice("Toggl Track integration plugin is not installed, enabled, or connected to your Toggl account.", 5000);
        throw new Error("Toggl Track integration plugin not found.");
    }
    togglApi = togglPlugin.toggl._apiManager;
    quickAddApi = params.quickAddApi;
    projects = await togglApi.getProjects();

    await openMainMenu(menu);
}

const dateInSeconds = (date) => {
    return Math.floor(date / 1000);
}

async function startTimer(entryName, projectID) {
    await togglApi.startTimer({description: entryName, pid: projectID});
}

async function openMainMenu(menu) {
    const {suggester} = quickAddApi;
    const options = Object.keys(menu);

    const choice = await suggester(options, options);
    if (!choice) return;

    const project = menu[choice];
    await openSubMenu(project);
}

async function openSubMenu(project) {
    const {suggester} = quickAddApi;
    const options = [...Object.keys(project.menuOptions), back];

    const choice = await suggester(options, options);
    if (!choice) return;

    if (choice === back) {
        return await openMainMenu(menu);
    }

    const entryName = project.menuOptions[choice];
    const togglProject = projects.find(p => p.name === project.togglProjectName);
    if (!togglProject) {
        new Notice(`Toggl project "${project.togglProjectName}" not found. Edit the menu in togglManager.js to match your Toggl projects.`, 5000);
        return;
    }

    await startTimer(entryName, togglProject.id);
}
