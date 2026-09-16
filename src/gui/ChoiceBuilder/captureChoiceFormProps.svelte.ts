import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { createChoiceFormProps, type ChoiceFormProps } from "./choiceFormProps.svelte";

export type CaptureChoiceFormProps = ChoiceFormProps<ICaptureChoice>;
export const createCaptureChoiceFormProps = createChoiceFormProps<ICaptureChoice>;
