import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { createChoiceFormProps, type ChoiceFormProps } from "./choiceFormProps.svelte";

export type TemplateChoiceFormProps = ChoiceFormProps<ITemplateChoice>;
export const createTemplateChoiceFormProps = createChoiceFormProps<ITemplateChoice>;
