import { IsActionFolder } from "src/utility/IsActionFolder";
import create from "zustand";
import { combine, subscribeWithSelector } from "zustand/middleware";
import { Choice } from "../types/choices/Choice";

interface ActionStoreState {
	actions: Choice[];
}

function actionSearch(id: string, actions: Choice[]): { action: Choice , parent?: Choice; } | null {
    for (const action of actions) {
        if (action.id === id) {
            return { action };
        }

        if (IsActionFolder(action)) {
            const result = actionSearch(id, action.choices);
            if (result && result.action) {
                return { action, parent: result.action };
            }
        }
    }

    return null;
}

const useActionStore = create(
    subscribeWithSelector(combine({ actions: [] as Choice[] }, (set) => ({
        moveActionIntoFolder: (actionId: string, folderId: string) => {
            set(state => {
                const actions = state.actions;

                const action = actionSearch(actionId, actions);
                if (!action) {
                    console.error(`Could not find action with id ${actionId}`);
                    return state;
                }

                const targetFolder = actionSearch(folderId, actions);
                if (!targetFolder) {
                    console.error(`Could not find folder with id ${folderId}`);
                    return state;
                }

                if (!IsActionFolder(targetFolder.action)) {
                    console.error(`Action with id ${folderId} is not a folder`);
                    return state;
                }

                const index = actions.indexOf(action.action);
                if (index === -1) {
                    return state;
                }

                actions.splice(index, 1);
                targetFolder.action.choices.push(action.action);
                
                return { actions };
            })
        }
    })))
);

export default useActionStore;