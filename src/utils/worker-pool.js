import { logger } from "./logger.js";
import { sleep } from "./helpers.js";

export class WorkerPool {
	constructor(maxConcurrent) {
		this.queue = [];
		this.processing = new Set();
		this.maxConcurrent = maxConcurrent;
	}

	async process(items, processor) {
		this.queue.push(...items);

		while (this.queue.length > 0 || this.processing.size > 0) {
			while (
				this.processing.size < this.maxConcurrent &&
				this.queue.length > 0
			) {
				const item = this.queue.shift();
				this.processing.add(item);

				// Process item and ensure it's awaited
				(async () => {
					try {
						await processor(item);
					} catch (error) {
						logger.error(`Error processing item:`, error);
					} finally {
						this.processing.delete(item);
					}
				})();
			}

			await sleep(100);
		}
	}

	addItems(items) {
		this.queue.push(...items);
	}

	getQueueSize() {
		return this.queue.length;
	}

	getProcessingSize() {
		return this.processing.size;
	}
}
