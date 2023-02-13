import * as ob from 'obsidian';
import { Notice } from 'obsidian';
interface TParams {
  app: ob.App,
  obsidian: {Notice:ob.Notice},
  quickAddApi: {
    suggester: any,
    yesNoPrompt: any,
  };
}
const splitLinksRegex = new RegExp(/\[\[(.+?)\]\]/g);
export async function archiveTasksToProject(params: TParams) {
  const {
    app,
    quickAddApi: { suggester, yesNoPrompt },
  } = params;
  const { getPropertyValue } = app.plugins.plugins["metaedit"].api;

  const allFiles = app.vault.getFiles();
  let projectTasks = new Map<string, ob.TFile[]>();
  let file_count = 0;

  for (const file of allFiles) {
    if (file.parent.path !== "任务") continue;
    const projField: string = await getPropertyValue('项目', file.path);
    const completedField = await getPropertyValue('完成', file.path);
    if (!projField || !completedField) continue;
    const taskProject = projField.match(splitLinksRegex)?.map((link: string) => link.slice(2, link.length - 2)).at(0);
    if (!taskProject) continue;
    if (!projectTasks.has(taskProject)) {
      projectTasks.set(taskProject, []);
    }
    if (completedField) {
      projectTasks.get(taskProject)?.push(file);
      file_count++;
    }
  };

  const folders = app.vault
    .getAllLoadedFiles()
    //@ts-ignore
    .filter((f) => f.children)
    .map((f) => f.path);

  new Notice("待归档文件有" + file_count + "项", 50);

  let archived = 0;

  projectTasks.forEach((tasks, proj) => {
    const projFolder = folders.find((f) => f.startsWith("项目/" + proj));
    if (!projFolder) return;
    if (!tasks) return;
    tasks.forEach((taskFile) => {
      archived++;
      app.fileManager.renameFile(
        taskFile,
        `${projFolder}/${taskFile.name}`
      );
    });
  });

  new Notice("发起归档" + archived + "项", 1);
};