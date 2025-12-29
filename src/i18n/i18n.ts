import { moment } from "obsidian";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

const locales: { [key: string]: any } = { en, fr };

export function t(path: string): string {
    const lang = moment.locale();
    const locale = locales[lang] || locales.en;
    
    // Permet d'accéder aux objets imbriqués (ex: "settings.headers.choices")
    const value = path.split('.').reduce((obj, key) => obj?.[key], locale);
    
    return value || path;
}
