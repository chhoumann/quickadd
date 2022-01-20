import GenericWideInputPrompt from './GenericWideInputPrompt/GenericWideInputPrompt';
import GenericInputPrompt from './GenericInputPrompt/GenericInputPrompt';
import QuickAdd from '../main';

export default class InputPrompt {
    public factory() {
        if (QuickAdd.instance.settings.inputPrompt === "multi-line") {
            return GenericWideInputPrompt;
        } else {
            return GenericInputPrompt;
        }
    }
}