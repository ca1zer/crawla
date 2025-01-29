import { config } from "./config.js";
import { initDb, getUnprocessedUsers } from "./db/sqlite.js";
import { logger } from "./utils/logger.js";
import { analytics } from "./utils/analytics.js";
import { Crawler } from "./crawler/processor.js";

async function main() {
	initDb();
	const crawler = new Crawler(config);
	let offset = 0;
	const batchSize = 1000;

	logger.info("Starting batch processing of unprocessed users...");

	while (true) {
		const batch = getUnprocessedUsers(batchSize, offset);
		if (batch.length === 0) {
			logger.info("No more unprocessed users found. Exiting.");
			break;
		}

		logger.info(
			`Fetched ${batch.length} unprocessed users from offset ${offset}`
		);
		offset += batchSize;

		const items = batch.map((user) => ({
			user_id: user.user_id.toString(),
			depth: 0,
		}));

		await crawler.workerPool.process(items, async (item) => {
			try {
				await crawler.processUser(item);
			} catch (err) {
				analytics.recordFailure();
				logger.error("Error processing user:", err);
			}
		});

		// Save stats after finishing each batch
		await analytics.saveStats();
		logger.info(`Completed batch up to offset ${offset}`);
	}

	logger.info("All unprocessed users have been processed. Exiting now...");
	process.exit(0);
}

main();
