import { expect, it } from "vitest";
import { describePerf } from "../tests/perfUtils";
import { createPropertyPipeline, propertyTemplate } from "../tests/helpers/template-properties/pipeline";

describePerf("Production template property pipeline performance", () => {
	it.each([
		{ count: 5, threshold: 50 },
		{ count: 15, threshold: 100 },
		{ count: 75, threshold: 500 },
		{ count: 150, threshold: 1000 },
	])("collects and writes $count properties within $threshold ms", async ({ count, threshold }) => {
		const values = Object.fromEntries(Array.from({ length: count }, (_, index) => [`var${index}`, [index]]));
		const template = propertyTemplate(Object.keys(values));
		const pipeline = createPropertyPipeline();
		const started = performance.now();
		await pipeline.process(pipeline.collect(template, values));
		expect(performance.now() - started).toBeLessThan(threshold);
		expect(pipeline.frontmatter).toEqual(values);
		expect(pipeline.collector.drain().size).toBe(0);
	});

	it("processes repeated templates without retaining prior variables", async () => {
		const pipeline = createPropertyPipeline();
		const started = performance.now();
		for (let index = 0; index < 100; index++) {
			const key = `iteration${index}`;
			const variables = pipeline.collect(propertyTemplate([key]), { [key]: [index] });
			expect([...variables.keys()]).toEqual([key]);
			await pipeline.process(variables);
			expect(pipeline.frontmatter[key]).toEqual([index]);
		}
		expect(performance.now() - started).toBeLessThan(1000);
	});

	it("writes large nested structures within one second", async () => {
		const value = Array.from({ length: 1000 }, (_, index) => ({ id: index, nested: { value: `item${index}` } }));
		const pipeline = createPropertyPipeline();
		const started = performance.now();
		await pipeline.process(pipeline.collect(propertyTemplate(["data"]), { data: value }));
		expect(performance.now() - started).toBeLessThan(1000);
		expect(pipeline.frontmatter.data).toEqual(value);
	});
});
