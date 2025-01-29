import { ApiClient } from "../api/client.js";
import * as db from "../db/sqlite.js";
import { logger } from "../utils/logger.js";
import { analytics } from "../utils/analytics.js";
import { WorkerPool } from "../utils/worker-pool.js";
import { NicheDetector } from "../ai/niche-detector.js";

export class Crawler {
	constructor(config) {
		this.config = config;
		this.workerPool = new WorkerPool(5);
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
				return true; // !db.userExists(userId); // we need to recrawl them anyways, but wont need to refetch the resource
			})
			.map((user) => ({
				user_id: user.user_id.toString(),
				user,
				depth,
			}));

		newItems.forEach(({ user, user_id, depth }) => {
			if (user.last_updated) {
				logger.info(
					`Skipping user ${user.username} as they are already in the db`
				);
				return;
			} // user already in the db

			const userData = {
				...user,
				user_id: user_id,
				last_updated: Date.now(),
				followers_crawled: false,
				bfs_depth: depth,
				is_in_niche: false,
				checked_in_niche: false,
			};

			db.saveUser(userData);
		});

		if (newItems.length > 0) {
			this.workerPool.addItems(newItems);
		}
	}

	async addSeedUsers(user_id) {
		const batchSize = 200;
		const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

		for (let i = 0; i < user_id.length; i += batchSize) {
			const batch = user_id.slice(i, i + batchSize);
			const promises = batch.map(async (user_id) => {
				try {
					const user = await this.api.getUserDetails({ user_id });
					// console.log(user.username, user.user_id);
					this.addNewUsers([user], 0);
				} catch (error) {
					logger.error(`Failed to add seed user ${user_id}`, error);
				}
			});

			await Promise.all(promises);

			if (i + batchSize < user_id.length) {
				await sleep(1000);
			}
		}
	}

	shouldAddUsersFollowing(user, depth) {
		return (
			user.follower_count >= this.config.minFollowers &&
			depth <= this.config.maxDepth
		);
	}

	async processUser(item) {
		const { user_id, depth } = item; // item includes user, but i still want to get it from the db incase an

		try {
			const [user, tweets] = await Promise.all([
				this.api.getUserDetails({ user_id: user_id.toString() }),
				this.api.getUserTweets({ user_id: user_id.toString() }, 100),
			]);
			// console.log(user);
			if (user.checked_in_niche) return user;

			let isInNiche = await this.nicheDetector.isUserInNiche(user, tweets);

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
			// const newUser = await this.api.getUserDetails({
			// 	user_id: user_id.toString(),
			// });
			// console.log(newUser);

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
				const user = await this.processUser(item); // only does something if checked_in_niche is false
				usersCrawled++;

				if (usersCrawled % 100 === 0) {
					logger.info(`=== Progress Update: ${usersCrawled} users crawled ===`);
				}

				if (
					user &&
					user.is_in_niche &&
					this.shouldAddUsersFollowing(user, item.depth)
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
			// logger.info(
			// 	`Queue size: ${this.workerPool.getQueueSize()}, Processing: ${this.workerPool.getProcessingSize()}, Success rate: ${analytics
			// 		.getSuccessRate()
			// 		.toFixed(2)}%`
			// );
		};

		await this.workerPool.process([], processUserAndFollowing);
		await analytics.saveStats();

		logger.info(`Crawler finished. Total users crawled: ${usersCrawled}`);
	}
}
