import { ApiClient } from "../api/client.js";
import * as db from "../db/sqlite.js";
import { logger } from "../utils/logger.js";
import { analytics } from "../utils/analytics.js";
import { WorkerPool } from "../utils/worker-pool.js";
import { NicheDetector } from "../ai/niche-detector.js";

export class Crawler {
	constructor(config) {
		this.config = config;
		this.workerPool = new WorkerPool(10);
		this.api = new ApiClient(config.refreshHours);
		this.nicheDetector = new NicheDetector(config.niche);
		this.seenUsers = new Set();
		this.lastCleanupTime = Date.now();
		this.CLEANUP_INTERVAL = 5 * 60 * 1000;
	}

	cleanupSeenUsers() {
		const now = Date.now();
		if (now - this.lastCleanupTime > this.CLEANUP_INTERVAL) {
			const size = this.seenUsers.size;
			this.seenUsers.clear();
			this.lastCleanupTime = now;
			logger.info(`Cleared seenUsers Set (freed ~${size} items)`);
		}
	}

	addNewUsers(users, depth) {
		const newItems = users
			.filter((user) => {
				const userId = user.user_id.toString();
				if (this.seenUsers.has(userId)) return false;
				this.seenUsers.add(userId);
				return !db.userExists(userId);
			})
			.map((user) => ({
				user_id: user.user_id.toString(),
				depth,
			}));

		if (newItems.length > 0) {
			this.workerPool.addItems(newItems);
		}
	}

	async addSeedUsers(usernames) {
		for (const username of usernames) {
			try {
				const user = await this.api.getUserDetails({ username });
				this.addNewUsers([user], 0);
			} catch (error) {
				logger.error(`Failed to add seed user ${username}`, error);
			}
		}
	}

	shouldProcessUser(user, depth) {
		return (
			user.follower_count >= this.config.minFollowers &&
			depth <= this.config.maxDepth
		);
	}

	async processUser(item) {
		const { user_id, depth } = item;

		try {
			const [user, tweets] = await Promise.all([
				this.api.getUserDetails({ user_id: user_id.toString() }),
				this.api.getUserTweets({ user_id: user_id.toString() }, 100),
			]);

			let isInNiche;
			if (user.checked_in_niche) {
				isInNiche = user.is_in_niche;
			} else {
				isInNiche = await this.nicheDetector.isUserInNiche(user, tweets);
			}

			const userData = {
				...user,
				user_id: user.user_id.toString(),
				last_updated: Date.now(),
				followers_crawled: false,
				bfs_depth: depth,
				is_in_niche: isInNiche,
				checked_in_niche: true,
			};

			db.saveUser(userData);

			if (tweets && tweets.length > 0) {
				db.saveTweets(user_id.toString(), tweets);
			}

			logger.info(
				`Processed user: ${user.username} (${user.follower_count} followers) - In niche: ${isInNiche}`
			);

			return userData;
		} catch (error) {
			logger.error(`Error processing user ${user_id.toString()}:`, error);
			return null;
		}
	}

	async start() {
		logger.info("Starting crawler...");
		let usersCrawled = 0;

		const processUserAndFollowing = async (item) => {
			const startTime = Date.now();

			try {
				this.cleanupSeenUsers();
				const user = await this.processUser(item);
				usersCrawled++;

				if (usersCrawled % 100 === 0) {
					logger.info(`=== Progress Update: ${usersCrawled} users crawled ===`);
				}

				if (
					user &&
					user.is_in_niche &&
					this.shouldProcessUser(user, item.depth) &&
					db.shouldCrawlFollowing(user.user_id)
				) {
					const following = await this.api.getFollowing(user.user_id);

					this.addNewUsers(following, item.depth + 1);

					db.saveFollowingRelationships(user.user_id, following);
					db.markFollowersCrawled(user.user_id);
				}

				analytics.recordSuccess(Date.now() - startTime);
			} catch (error) {
				analytics.recordFailure();
				logger.error("Error in processUserAndFollowing:", error);
			}

			// Record queue size
			analytics.recordQueueSize(this.workerPool.getQueueSize());
			// Log progress
			logger.info(
				`Queue size: ${this.workerPool.getQueueSize()}, Processing: ${this.workerPool.getProcessingSize()}, Success rate: ${analytics
					.getSuccessRate()
					.toFixed(2)}%`
			);
		};

		await this.workerPool.process([], processUserAndFollowing);
		await analytics.saveStats();

		logger.info(`Crawler finished. Total users crawled: ${usersCrawled}`);
	}
}
