import * as fs from "fs/promises";
import { logger } from "./logger.js";

class Analytics {
	constructor() {
		this.processingTimes = [];
		this.statsFile = "data/stats.json";
		this.stats = {
			totalUsersCrawled: 0,
			successfulRequests: 0,
			failedRequests: 0,
			averageProcessingTimeMs: 0,
			queueSizeHistory: [],
			startTime: Date.now(),
			lastUpdated: Date.now(),
		};
	}

	recordSuccess(processingTimeMs) {
		this.stats.successfulRequests++;
		this.stats.totalUsersCrawled++;
		this.processingTimes.push(processingTimeMs);
		this.updateAverageProcessingTime();
	}

	recordFailure() {
		this.stats.failedRequests++;
	}

	recordQueueSize(size) {
		this.stats.queueSizeHistory.push(size);
		// Keep only last 1000 queue size measurements
		if (this.stats.queueSizeHistory.length > 1000) {
			this.stats.queueSizeHistory.shift();
		}
	}

	updateAverageProcessingTime() {
		const sum = this.processingTimes.reduce((a, b) => a + b, 0);
		this.stats.averageProcessingTimeMs = sum / this.processingTimes.length;
		// Keep only last 1000 processing times
		if (this.processingTimes.length > 1000) {
			this.processingTimes.shift();
		}
	}

	async saveStats() {
		try {
			this.stats.lastUpdated = Date.now();
			await fs.writeFile(this.statsFile, JSON.stringify(this.stats, null, 2));
			logger.debug("Analytics saved to stats.json");
		} catch (error) {
			logger.error("Failed to save analytics", error);
		}
	}

	getStats() {
		return { ...this.stats };
	}

	getSuccessRate() {
		const total = this.stats.successfulRequests + this.stats.failedRequests;
		return total === 0 ? 0 : (this.stats.successfulRequests / total) * 100;
	}
}

// Export singleton instance
export const analytics = new Analytics();

// Save stats periodically (every 5 minutes)
setInterval(() => {
	analytics.saveStats();
}, 5 * 60 * 1000);

// Save stats on process exit
process.on("exit", () => {
	analytics.saveStats();
});

process.on("SIGINT", () => {
	analytics.saveStats();
	process.exit();
});
