import type { Model } from "./models";


export function getModelMaxTokens(model: Model) {
    switch (model) {
        case "text-davinci-003":
            return 4096;
        case "gpt-3.5-turbo":
            return 4096;
        case "gpt-4":
            return 8192;
        case "gpt-3.5-turbo-16k":
            return 16384;
        case "gpt-3.5-turbo-1106":
            return 16385;
        case "gpt-4-1106-preview":
            return 128000;
        case "gpt-4-32k":
            return 32768;
    }
}
