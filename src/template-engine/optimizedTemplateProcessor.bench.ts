// @ts-nocheck
import { bench, run } from "vitest";
import { OptimizedTemplateProcessor } from "./OptimizedTemplateProcessor";

const processor = new OptimizedTemplateProcessor();

function naiveLegacyProcess(tpl: string, vars: Record<string, string>) {
  let out = tpl;
  out = out.replace(/{{VALUE:([^}|]+)}}/g, (_, name) => vars[name.trim()] ?? "");
  return out;
}

const template = Array.from({ length: 1000 }, (_, i) => `Item ${i}: {{VALUE:v${i}}}`).join("\n");
const vars: Record<string, string> = Object.fromEntries(
  Array.from({ length: 1000 }, (_, i) => [`v${i}`, `${i}`]),
);

bench("OptimizedTemplateProcessor", () => {
  processor.process(template, vars);
});

bench("Naive legacy", () => {
  naiveLegacyProcess(template, vars);
});

// run is optional when using Vitest CLI, but Vite-less environment may require it.
if (import.meta.vitest) {
  run();
}