module.exports = {SelectFromAllTasks, GetAllTasksFromProject, GetAllTasksFromSection};

const getTodoistPluginApi = (app) => app.plugins.plugins["todoist-sync-plugin"].api;

/* API */
async function SelectFromAllTasks(params) {
    const tasks = await getAllTasks(params);
    if (tasks.length === 0) {
        new Notice("No tasks.");
        return;
    }
    const selectedTasks = await selectTasks(params, tasks);

    await closeSelectedTasks(params.app, selectedTasks);
    return formatTasksToTasksPluginTask(selectedTasks);
}

async function GetAllTasksFromProject(params) {
    const [allTasks, projects] = await Promise.all([getAllTasks(params), getProjects(params.app)]);
    const targetProject = await params.quickAddApi.suggester(project => {
        project.tasks = allTasks.filter(task => task.projectID === project.id);

        return `${project.name} (${project.tasks.length})`;
    }, projects);
    if (!targetProject) return;

    if (targetProject.tasks.length === 0) {
        new Notice(`No tasks in '${targetProject.name}'.`);
        return;
    } else {
        new Notice(`Added ${targetProject.tasks.length} tasks from '${targetProject.name}'.`)
    }

    await closeSelectedTasks(params.app, targetProject.tasks);
    return formatTasksToTasksPluginTask(targetProject.tasks);
}

async function GetAllTasksFromSection(params) {
    const [projects, sections, allTasks] = await Promise.all([getProjects(params.app), getSections(params.app), getAllTasks(params)]);

    const targetSection = await params.quickAddApi.suggester(section => {
        const sectionProject = projects.find(project => project.id === section["project_id"]);
        section.tasks = allTasks.filter(task => task.sectionID === section.id);
        return `${sectionProject.name} > ${section.name} (${section.tasks.length})`;
    }, sections);

    if (targetSection.tasks.length === 0) {
        new Notice(`No tasks in '${targetSection.name}'.`);
        return;
    } else {
        new Notice(`Added ${targetSection.tasks.length} tasks from '${targetSection.name}'.`)
    }

    await closeSelectedTasks(targetSection.tasks);
    return formatTasksToTasksPluginTask(targetSection.tasks);
}

/* Helpers */
async function getAllTasks(params) {
    const api = getTodoistPluginApi(params.app);
    const {ok: tasks} = await api.getTasks();
    return tasks;
}

async function selectTasks(params, tasks) {
    const selectedTaskNames = await params.quickAddApi.checkboxPrompt(tasks.map(task => task.content));
    return tasks.filter(task => selectedTaskNames.some(t => t.contains(task.content)));
}

async function closeSelectedTasks(app, tasks) {
    const api = getTodoistPluginApi(app);
    tasks.forEach(async task => await api.closeTask(task.id));
}

function formatTasksToTasksPluginTask(tasks) {
    return tasks.map(task =>
         task.rawDatetime ?
            task = `- [ ] ${task.content} 📅 ${task.rawDatetime.format("YYYY-MM-DD")}` :
            task = `- [ ] ${task.content}`
    ).join("\n") + "\n";
}

async function getTasksGroupedByProject(app) {
    const api = getTodoistPluginApi(app);
    const {ok: projects} = await api.getTasksGroupedByProject();
    return projects;
}

async function getProjects(app) {
    const api = getTodoistPluginApi(app);
    const {ok: projects} = await api.getProjects();
    return projects;
}

async function getSections(app) {
    const api = getTodoistPluginApi(app);
    const {ok: sections} = await api.getSections();
    return sections;
}