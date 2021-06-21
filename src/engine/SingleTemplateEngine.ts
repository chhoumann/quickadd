import {TemplateEngine} from "./TemplateEngine";
import type {App} from "obsidian";
import type QuickAdd from "../main";

export class SingleTemplateEngine extends TemplateEngine {
    constructor(app: App, plugin: QuickAdd, private templatePath: string) {
        super(app, plugin);
    }
    public async run(): Promise<string> {
        let templateContent: string = await this.getTemplateContent(this.templatePath);
        if (!templateContent) {
            throw new Error(`Template ${this.templatePath} not found.`);
        }

        templateContent = await this.formatter.formatFileContent(templateContent);

        if (this.templater) {
            templateContent = this.templater.templater.parser.parseTemplates(templateContent);
        }

        return templateContent;
    }
}