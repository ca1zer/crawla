import { config } from "./config.js";
import { initDb } from "./db/sqlite.js";
import { Crawler } from "./crawler/processor.js";
import { logger } from "./utils/logger.js";
import * as fs from "fs/promises";

async function main() {
	try {
		await fs.mkdir("data", { recursive: true });
		initDb();

		const seedData = await fs.readFile("initUsers.json", "utf-8");
		const { usernames } = JSON.parse(seedData);

		logger.info(`Loaded ${usernames.length} seed users from initUsers.json`);

		const crawler = new Crawler(config);
		await crawler.addSeedUsers(usernames);

		await crawler.start(false, false); // crawlFollowing=true, force=false
	} catch (error) {
		logger.error("Application error:", error);
		process.exit(1);
	}
}

main();
