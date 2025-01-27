import * as db from "../db/sqlite.js";
import * as twitter from "./twitter.js";
import { logger } from "../utils/logger.js";

export class ApiClient {
	constructor(refreshHours) {
		this.refreshHours = refreshHours;
	}

	async getUserDetails(identifier) {
		// Ensure user_id is string if present
		const normalizedIdentifier = identifier.user_id
			? { ...identifier, user_id: identifier.user_id.toString() }
			: identifier;

		// If we have a user_id, check DB first
		if (normalizedIdentifier.user_id) {
			const cachedUser = db.getUser(normalizedIdentifier.user_id);
			if (
				cachedUser &&
				!db.isUserStale(normalizedIdentifier.user_id, this.refreshHours)
			) {
				logger.debug(
					`Using cached data for user ${normalizedIdentifier.user_id}`
				);
				return cachedUser;
			}
		}
		console.log("User not cached, fetching from API", normalizedIdentifier);
		const user = await twitter.getUserDetails(normalizedIdentifier);
		// Ensure user_id is string
		return { ...user, user_id: user.user_id.toString() };
	}

	async getFollowing(userId, force = false) {
		userId = userId.toString();

		// Check if we already have this user's following list in DB
		if (!force) {
			const cachedFollowingIds = db.getFollowingIds(userId);
			if (cachedFollowingIds.length > 0) {
				const followingUsers = [];
				for (const followingId of cachedFollowingIds) {
					const user = await this.getUserDetails({
						user_id: followingId.toString(),
					});
					followingUsers.push(user);
				}
				return followingUsers;
			}
		}
		console.log("Following not cached for user ", userId);
		const normalizedFollowing = await twitter.getFollowing(userId);
		return normalizedFollowing;
	}

	async getUserTweets(identifier, limit = 100) {
		const userId = identifier.user_id;
		const cachedTweets = db.getUserTweets(userId, limit);
		if (cachedTweets && cachedTweets.length > 0) {
			return cachedTweets;
		}
		console.log("Tweets not cached for user ", userId);
		const tweets = await twitter.getUserTweets(identifier, limit);
		return tweets;
	}
}
