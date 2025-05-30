import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProgressTracker, ProgressManager, withProgress, type ProgressUpdate } from "./ProgressTracker";

describe("ProgressTracker", () => {
	beforeEach(() => {
		ProgressManager.cancelAll();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("ProgressTracker", () => {
		it("should track progress correctly", () => {
			const tracker = new ProgressTracker("test", 10);
			
			expect(tracker.getProgress().current).toBe(0);
			expect(tracker.getProgress().percentage).toBe(0);
			
			tracker.update(5);
			expect(tracker.getProgress().current).toBe(5);
			expect(tracker.getProgress().percentage).toBe(50);
			
			tracker.complete();
			expect(tracker.getProgress().current).toBe(10);
			expect(tracker.getProgress().percentage).toBe(100);
			expect(tracker.isComplete).toBe(true);
		});

		it("should auto-increment when no current value provided", () => {
			const tracker = new ProgressTracker("test", 5);
			
			tracker.update(); // Should increment to 1
			tracker.update(); // Should increment to 2
			tracker.update(); // Should increment to 3
			
			expect(tracker.getProgress().current).toBe(3);
			expect(tracker.getProgress().percentage).toBe(60);
		});

		it("should call callback with progress updates", () => {
			const callback = vi.fn();
			const tracker = new ProgressTracker("test", 10, callback);
			
			// First update should call callback
			tracker.update(1);
			expect(callback).toHaveBeenCalledWith(
				expect.objectContaining({
					current: 1,
					total: 10,
					percentage: 10
				})
			);
			
			// Complete should call callback
			tracker.complete();
			expect(callback).toHaveBeenCalledWith(
				expect.objectContaining({
					current: 10,
					total: 10,
					percentage: 100
				})
			);
		});

		it("should throttle updates based on interval", () => {
			const callback = vi.fn();
			const tracker = new ProgressTracker("test", 10, callback, { updateInterval: 200 });
			
			// Multiple rapid updates
			tracker.update(1);
			tracker.update(2);
			tracker.update(3);
			
			// Should only have called callback once due to throttling
			expect(callback).toHaveBeenCalledTimes(1);
			
			// Advance time beyond throttle interval
			vi.advanceTimersByTime(300);
			tracker.update(4);
			
			// Should now call callback again
			expect(callback).toHaveBeenCalledTimes(2);
		});

		it("should include time estimation in progress", () => {
			const tracker = new ProgressTracker("test", 10, undefined, { estimateTime: true });
			
			// Update progress
			tracker.update(2);
			
			const progress = tracker.getProgress();
			// Should have estimatedTimeRemaining field (even if 0 or undefined in fast test)
			expect(progress).toHaveProperty('estimatedTimeRemaining');
		});

		it("should handle cancellation", () => {
			const tracker = new ProgressTracker("test", 10);
			
			tracker.update(5);
			expect(tracker.isComplete).toBe(false);
			
			tracker.cancel();
			expect(tracker.isComplete).toBe(true);
			
			// Further updates should be ignored
			tracker.update(8);
			expect(tracker.getProgress().current).toBe(5);
		});

		it("should include additional context in updates", () => {
			const callback = vi.fn();
			const tracker = new ProgressTracker("test", 5, callback);
			
			tracker.update(1, "file1.md", "Scanning");
			
			expect(callback).toHaveBeenCalledWith(
				expect.objectContaining({
					current: 1,
					currentFile: "file1.md",
					phase: "Scanning"
				})
			);
		});
	});

	describe("ProgressManager", () => {
		it("should create and manage trackers", () => {
			const tracker1 = ProgressManager.create("op1", 10);
			const tracker2 = ProgressManager.create("op2", 20);
			
			expect(ProgressManager.get("op1")).toBe(tracker1);
			expect(ProgressManager.get("op2")).toBe(tracker2);
			expect(ProgressManager.getActiveOperations()).toEqual(["op1", "op2"]);
		});

		it("should cancel individual trackers", () => {
			const tracker = ProgressManager.create("test", 10);
			
			expect(ProgressManager.get("test")).toBe(tracker);
			expect(tracker.isComplete).toBe(false);
			
			ProgressManager.cancel("test");
			
			expect(ProgressManager.get("test")).toBeUndefined();
			expect(tracker.isComplete).toBe(true);
		});

		it("should cancel all trackers", () => {
			const tracker1 = ProgressManager.create("op1", 10);
			const tracker2 = ProgressManager.create("op2", 20);
			
			ProgressManager.cancelAll();
			
			expect(ProgressManager.getActiveOperations()).toEqual([]);
			expect(tracker1.isComplete).toBe(true);
			expect(tracker2.isComplete).toBe(true);
		});

		it("should replace existing tracker with same ID", () => {
			const tracker1 = ProgressManager.create("test", 10);
			expect(tracker1.isComplete).toBe(false);
			
			const tracker2 = ProgressManager.create("test", 20);
			
			// First tracker should be cancelled
			expect(tracker1.isComplete).toBe(true);
			expect(ProgressManager.get("test")).toBe(tracker2);
		});

		it("should format progress messages", () => {
			const update: ProgressUpdate = {
				current: 5,
				total: 10,
				percentage: 50,
				currentFile: "test.md",
				phase: "Scanning",
				estimatedTimeRemaining: 5000
			};
			
			const message = ProgressManager.formatProgress(update);
			
			expect(message).toContain("Scanning");
			expect(message).toContain("5/10");
			expect(message).toContain("50.0%");
			expect(message).toContain("test.md");
			expect(message).toContain("5s");
		});

		it("should create progress bars", () => {
			const bar0 = ProgressManager.createProgressBar(0, 10);
			expect(bar0).toBe("░░░░░░░░░░");
			
			const bar50 = ProgressManager.createProgressBar(50, 10);
			expect(bar50).toBe("█████░░░░░");
			
			const bar100 = ProgressManager.createProgressBar(100, 10);
			expect(bar100).toBe("██████████");
		});
	});

	describe("withProgress", () => {
		it("should process items with progress tracking", async () => {
			const items = ["a", "b", "c", "d", "e"];
			const processedItems: string[] = [];
			const progressUpdates: ProgressUpdate[] = [];
			
			const callback = vi.fn((update: ProgressUpdate) => {
				progressUpdates.push(update);
			});
			
			await withProgress(
				"test-batch",
				items,
				async (item, index, tracker) => {
					processedItems.push(item);
					// No delay needed for test
				},
				callback
			);
			
			expect(processedItems).toEqual(items);
			expect(progressUpdates.length).toBeGreaterThan(0);
			expect(progressUpdates[progressUpdates.length - 1].percentage).toBe(100);
		});

		it("should handle errors and cleanup", async () => {
			const items = ["a", "b", "c"];
			const error = new Error("Processing failed");
			
			await expect(
				withProgress(
					"test-error",
					items,
					async (item, index) => {
						if (index === 1) throw error;
					}
				)
			).rejects.toThrow("Processing failed");
			
			// Tracker should be cleaned up
			expect(ProgressManager.get("test-error")).toBeUndefined();
		});

		it("should handle cancellation during processing", async () => {
			const items = ["a", "b", "c", "d", "e"];
			const processedItems: string[] = [];
			
			const processingPromise = withProgress(
				"test-cancel",
				items,
				async (item, index, tracker) => {
					if (index === 2) {
						// Cancel during processing
						ProgressManager.cancel("test-cancel");
					}
					processedItems.push(item);
				}
			);
			
			await processingPromise;
			
			// Should have processed items up to cancellation point
			expect(processedItems.length).toBeLessThan(items.length);
		});

		it("should work without callback", async () => {
			const items = [1, 2, 3];
			const results: number[] = [];
			
			await withProgress(
				"test-no-callback",
				items,
				async (item) => {
					results.push(item * 2);
				}
			);
			
			expect(results).toEqual([2, 4, 6]);
		});
	});

	describe("edge cases", () => {
		it("should handle zero total items", () => {
			const tracker = new ProgressTracker("test", 0);
			
			expect(tracker.getProgress().percentage).toBe(0);
			
			tracker.complete();
			expect(tracker.getProgress().percentage).toBe(100);
		});

		it("should not exceed 100% progress", () => {
			const tracker = new ProgressTracker("test", 5);
			
			tracker.update(10); // Update beyond total
			expect(tracker.getProgress().percentage).toBe(100);
		});

		it("should handle rapid completion", () => {
			const callback = vi.fn();
			const tracker = new ProgressTracker("test", 1, callback);
			
			tracker.update(1);
			tracker.complete();
			tracker.complete(); // Multiple completion calls
			
			expect(tracker.isComplete).toBe(true);
		});

		it("should format time estimates correctly", () => {
			const shortTime: ProgressUpdate = {
				current: 1,
				total: 2,
				percentage: 50,
				estimatedTimeRemaining: 3000
			};
			
			const longTime: ProgressUpdate = {
				current: 1,
				total: 2,
				percentage: 50,
				estimatedTimeRemaining: 150000
			};
			
			const shortMessage = ProgressManager.formatProgress(shortTime);
			const longMessage = ProgressManager.formatProgress(longTime);
			
			expect(shortMessage).toContain("3s");
			expect(longMessage).toContain("3m");
		});
	});
});