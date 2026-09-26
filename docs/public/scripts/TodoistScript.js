// Imports Todoist tasks into a note as Tasks-plugin checklist items.
// Talks to the Todoist API v1 directly: https://developer.todoist.com/api/v1/
// Docs: https://quickadd.obsidian.guide/docs/Examples/Capture_FetchTasksFromTodoist
const API_TOKEN = "Todoist API token";
const COMPLETE_TASKS = "Complete imported tasks in Todoist";
const TODOIST_API = "https://api.todoist.com/api/v1";

module.exports = {
    entry: async (params, settings) => {
        const exports = {SelectFromAllTasks, GetAllTasksFromProject, GetAllTasksFromSection};
        const names = Object.keys(exports);
        const selected = await params.quickAddApi.suggester(names, names, "Import Todoist tasks");
        if (!selected) return "";
        return exports[selected](params, settings);
    },
    settings: {
        name: "Todoist",
        author: "Christian B. B. Houmann",
        options: {
            [API_TOKEN]: {
                type: "secret",
                id: "todoist-api-token",
                placeholder: "Paste API token",
                description: "From Todoist's Developer settings.",
            },
            [COMPLETE_TASKS]: {
                type: "checkbox",
                defaultValue: true,
                description: "Mark each imported task as complete in Todoist, so it is only imported once.",
            },
        },
    },
    SelectFromAllTasks,
    GetAllTasksFromProject,
    GetAllTasksFromSection,
};

/* Exports */
async function SelectFromAllTasks(params, settings) {
    const todoist = createTodoistClient(params, settings);
    const tasks = await todoist.getAll("/tasks");
    if (tasks.length === 0) {
        new params.obsidian.Notice("No tasks in Todoist.");
        return "";
    }

    const labels = tasks.map((task, index) => `${index + 1}. ${task.content}`);
    const selectedLabels = await params.quickAddApi.checkboxPrompt(labels);
    const selectedTasks = tasks.filter((_, index) => selectedLabels.includes(labels[index]));

    return importTasks(params, settings, todoist, selectedTasks, "your selection");
}

async function GetAllTasksFromProject(params, settings) {
    const todoist = createTodoistClient(params, settings);
    const [projects, tasks] = await Promise.all([todoist.getAll("/projects"), todoist.getAll("/tasks")]);
    const tasksIn = (project) => tasks.filter(task => task.project_id === project.id);

    const project = await params.quickAddApi.suggester(
        projects.map(project => `${project.name} (${tasksIn(project).length})`),
        projects,
        "Import all tasks from project",
    );
    if (!project) return "";

    return importTasks(params, settings, todoist, tasksIn(project), `'${project.name}'`);
}

async function GetAllTasksFromSection(params, settings) {
    const todoist = createTodoistClient(params, settings);
    const [projects, sections, tasks] = await Promise.all([
        todoist.getAll("/projects"),
        todoist.getAll("/sections"),
        todoist.getAll("/tasks"),
    ]);
    const tasksIn = (section) => tasks.filter(task => task.section_id === section.id);
    const projectName = (section) => projects.find(project => project.id === section.project_id)?.name ?? "?";

    const section = await params.quickAddApi.suggester(
        sections.map(section => `${projectName(section)} > ${section.name} (${tasksIn(section).length})`),
        sections,
        "Import all tasks from section",
    );
    if (!section) return "";

    return importTasks(params, settings, todoist, tasksIn(section), `'${section.name}'`);
}

/* Helpers */
async function importTasks(params, settings, todoist, tasks, sourceName) {
    if (tasks.length === 0) {
        new params.obsidian.Notice(`No tasks in ${sourceName}.`);
        return "";
    }

    // Format before completing: a recurring task gets a new due date when completed.
    const output = formatTasksToTasksPluginTask(tasks);

    // IMPORTANT: this completes the imported tasks in Todoist.
    // Untick "Complete imported tasks in Todoist" in the script settings to keep them open.
    if (settings[COMPLETE_TASKS]) {
        const failed = await closeSelectedTasks(todoist, tasks);
        if (failed.length > 0) {
            new params.obsidian.Notice(`Could not complete ${failed.length} of ${tasks.length} imported tasks in Todoist; they are still open there.`, 10000);
        }
    }

    new params.obsidian.Notice(`Added ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} from ${sourceName}.`);
    return output;
}

// Returns the tasks that could not be completed. The note still gets every
// imported task, so a failed close never loses one that was already closed.
async function closeSelectedTasks(todoist, tasks) {
    const failed = [];
    for (const task of tasks) {
        try {
            await todoist.request("POST", `/tasks/${task.id}/close`);
        } catch (error) {
            console.error(`Todoist: could not complete task ${task.id}`, error);
            failed.push(task);
        }
    }
    return failed;
}

function formatTasksToTasksPluginTask(tasks) {
    return tasks.map(task => {
        const dueDate = formatDueDate(task.due);
        return dueDate ? `- [ ] ${task.content} 📅 ${dueDate}` : `- [ ] ${task.content}`;
    }).join("\n") + "\n";
}

// `due.date` is "YYYY-MM-DD", a floating "YYYY-MM-DDTHH:mm:ss", or a UTC
// "YYYY-MM-DDTHH:mm:ssZ" for tasks with a fixed time zone.
function formatDueDate(due) {
    if (!due?.date) return null;
    if (due.date.endsWith("Z")) return window.moment(due.date).format("YYYY-MM-DD");
    return due.date.slice(0, 10);
}

function createTodoistClient(params, settings) {
    const token = settings[API_TOKEN];
    if (!token) {
        throw new Error("Add your Todoist API token in the Todoist script's settings (the gear next to the script in your macro).");
    }

    async function request(method, path) {
        const response = await params.obsidian.requestUrl({
            url: `${TODOIST_API}${path}`,
            method,
            headers: {Authorization: `Bearer ${token}`},
            throw: false,
        });
        if (response.status === 401 || response.status === 403) {
            throw new Error(`Todoist rejected the API token (HTTP ${response.status}). Check the token in the Todoist script's settings.`);
        }
        if (response.status >= 400) {
            throw new Error(`Todoist request ${method} ${path.split("?")[0]} failed with HTTP ${response.status}.`);
        }
        return response.text ? response.json : null;
    }

    // List endpoints are paginated: follow `next_cursor` until it is null.
    async function getAll(path) {
        const results = [];
        let cursor = null;
        do {
            const query = `?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
            const page = await request("GET", `${path}${query}`);
            results.push(...page.results);
            cursor = page.next_cursor;
        } while (cursor);
        return results;
    }

    return {request, getAll};
}
