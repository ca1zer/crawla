import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";
import * as fs from "fs";
import * as path from "path";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
	fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, "twitter.db"));
db.pragma("foreign_keys = ON");

export function initDb() {
	db.exec(`
		CREATE TABLE IF NOT EXISTS users (
			user_id VARCHAR(32) PRIMARY KEY,
			username TEXT NOT NULL,
			name TEXT NOT NULL,
			follower_count INTEGER NOT NULL,
			following_count INTEGER NOT NULL,
			description TEXT,
			creation_date TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			is_private BOOLEAN NOT NULL,
			is_verified BOOLEAN NOT NULL,
			location TEXT,
			profile_pic_url TEXT,
			profile_banner_url TEXT,
			external_url TEXT,
			number_of_tweets INTEGER NOT NULL,
			bot BOOLEAN NOT NULL,
			has_nft_avatar BOOLEAN NOT NULL,
			last_updated INTEGER NOT NULL,
			followers_crawled BOOLEAN NOT NULL,
			bfs_depth INTEGER NOT NULL,
			is_in_niche BOOLEAN NOT NULL DEFAULT FALSE,
			checked_in_niche BOOLEAN NOT NULL DEFAULT FALSE
		)
	`);

	db.exec(`
		CREATE TABLE IF NOT EXISTS following_relationships (
			user_id VARCHAR(32) NOT NULL,
			following_id VARCHAR(32) NOT NULL,
			timestamp INTEGER NOT NULL,
			PRIMARY KEY (user_id, following_id),
			FOREIGN KEY (user_id) REFERENCES users(user_id),
			FOREIGN KEY (following_id) REFERENCES users(user_id)
		)
	`);

	db.exec(`
		CREATE TABLE IF NOT EXISTS tweets (
			tweet_id VARCHAR(32) PRIMARY KEY,
			user_id VARCHAR(32) NOT NULL,
			creation_date TEXT NOT NULL,
			text TEXT NOT NULL,
			timestamp INTEGER NOT NULL,
			favorite_count INTEGER NOT NULL,
			retweet_count INTEGER NOT NULL,
			reply_count INTEGER NOT NULL,
			quote_count INTEGER NOT NULL,
			views INTEGER NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(user_id)
		)
	`);

	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
		CREATE INDEX IF NOT EXISTS idx_users_last_updated ON users(last_updated);
		CREATE INDEX IF NOT EXISTS idx_following_user_id ON following_relationships(user_id);
		CREATE INDEX IF NOT EXISTS idx_following_following_id ON following_relationships(following_id);
		CREATE INDEX IF NOT EXISTS idx_tweets_user_id ON tweets(user_id);
	`);

	logger.info("Database initialized");
}

export function getUser(userId) {
	const user = db
		.prepare("SELECT * FROM users WHERE user_id = ?")
		.get(userId.toString());
	return user || null;
}

export function saveUser(user) {
	// Convert booleans to integers for SQLite
	const userData = {
		...user,
		is_private: user.is_private ? 1 : 0,
		is_verified: user.is_verified ? 1 : 0,
		bot: user.bot ? 1 : 0,
		has_nft_avatar: user.has_nft_avatar ? 1 : 0,
		followers_crawled: user.followers_crawled ? 1 : 0,
		is_in_niche: user.is_in_niche ? 1 : 0,
		checked_in_niche: user.checked_in_niche ? 1 : 0,
	};

	const stmt = db.prepare(`
		INSERT OR REPLACE INTO users (
			user_id, username, name, follower_count, following_count,
			description, creation_date, timestamp, is_private, is_verified,
			location, profile_pic_url, profile_banner_url, external_url,
			number_of_tweets, bot, has_nft_avatar, last_updated,
			followers_crawled, bfs_depth, is_in_niche, checked_in_niche
		) VALUES (
			@user_id, @username, @name, @follower_count, @following_count,
			@description, @creation_date, @timestamp, @is_private, @is_verified,
			@location, @profile_pic_url, @profile_banner_url, @external_url,
			@number_of_tweets, @bot, @has_nft_avatar, @last_updated,
			@followers_crawled, @bfs_depth, @is_in_niche, @checked_in_niche
		)
	`);

	stmt.run(userData);
	logger.debug(`Saved user ${userData.username} to database`);
}

export function saveTweets(userId, tweets) {
	// First ensure the user exists
	if (!userExists(userId)) {
		logger.warn(
			`Cannot save tweets: User ${userId} does not exist in database`
		);
		return;
	}

	const stmt = db.prepare(`
		INSERT OR REPLACE INTO tweets (
			tweet_id, user_id, creation_date, text, timestamp,
			favorite_count, retweet_count, reply_count, quote_count, views
		) VALUES (
			@tweet_id, @user_id, @creation_date, @text, @timestamp,
			@favorite_count, @retweet_count, @reply_count, @quote_count, @views
		)
	`);

	const insertTweets = db.transaction((tweets) => {
		for (const tweet of tweets) {
			stmt.run({
				...tweet,
				tweet_id: tweet.tweet_id.toString(),
				user_id: userId.toString(),
				views: tweet.views || 0, // Handle null views
			});
		}
	});

	insertTweets(tweets);
	logger.debug(`Saved ${tweets.length} tweets for user ${userId}`);
}

export function saveFollowingRelationships(userId, followingUsers) {
	const stmt = db.prepare(`
		INSERT OR REPLACE INTO following_relationships (
			user_id, following_id, timestamp
		) VALUES (@user_id, @following_id, @timestamp)
	`);

	const insertRelationships = db.transaction((users) => {
		const now = Date.now();
		for (const user of users) {
			stmt.run({
				user_id: userId.toString(),
				following_id: user.user_id.toString(),
				timestamp: now,
			});
		}
	});

	insertRelationships(followingUsers);
	logger.debug(
		`Saved ${followingUsers.length} following relationships for user ${userId}`
	);
}

export function userExists(userId) {
	const result = db
		.prepare("SELECT 1 FROM users WHERE user_id = ?")
		.get(userId.toString());
	return !!result;
}

export function isUserStale(userId, refreshHours) {
	const user = getUser(userId.toString());
	if (!user) return true;

	const hoursSinceUpdate = (Date.now() - user.last_updated) / (1000 * 60 * 60);
	return hoursSinceUpdate > refreshHours;
}

export function markFollowersCrawled(userId) {
	db.prepare("UPDATE users SET followers_crawled = TRUE WHERE user_id = ?").run(
		userId.toString()
	);
}

export function getAllUsers() {
	return db.prepare("SELECT * FROM users").all();
}

export function getFollowingIds(userId) {
	return db
		.prepare(
			"SELECT following_id FROM following_relationships WHERE user_id = ?"
		)
		.all(userId.toString())
		.map((row) => row.following_id);
}

export function getUserTweets(userId, limit = 100) {
	return db
		.prepare(
			`
        SELECT * FROM tweets 
        WHERE user_id = ? 
        ORDER BY timestamp DESC 
        LIMIT ?
    `
		)
		.all(userId.toString(), limit);
}

// Close database connection when the application exits
process.on("exit", () => db.close());
process.on("SIGINT", () => {
	db.close();
	process.exit();
});
