import QuickAdd from "src/main";
import { TemplateChoice } from "src/types/choices/TemplateChoice";
import { Migration } from "./Migrations";

const incrementFileNameSettingMoveToDefaultBehavior: Migration = {
    description: "'Increment file name' setting moved to 'Set default behavior if file already exists' setting",
    migrate: async (plugin: QuickAdd): Promise<boolean> => { 
        const choicesCopy = structuredClone(plugin.settings.choices);

        for (const choice of choicesCopy) {
            if (choice instanceof TemplateChoice && choice.incrementFileName) {
                choice.setFileExistsBehavior = true;
                choice.fileExistsMode = "increment";

                delete choice.incrementFileName;
            }
        }
                

        return false;
    }
}

export default incrementFileNameSettingMoveToDefaultBehavior;