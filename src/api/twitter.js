import axios from "axios";
import { logger } from "../utils/logger.js";
import { sleep } from "../utils/helpers.js";
import { apiRateLimiter } from "../utils/rate-limiter.js";

const API_BASE = "https://twitter154.p.rapidapi.com";
const headers = {
	"x-rapidapi-key": process.env.RAPID_API_KEY,
	"x-rapidapi-host": "twitter154.p.rapidapi.com",
};

// Implement exponential backoff for rate limits
async function makeRequest(url, params) {
	let attempts = 0;
	const maxAttempts = 5;

	while (attempts < maxAttempts) {
		try {
			// Wait for rate limiter before making request
			await apiRateLimiter.consume();

			const response = await axios.get(url, { headers, params });
			logger.debug(`API Response: ${JSON.stringify(response.data, null, 2)}`);
			return response.data;
		} catch (error) {
			attempts++;

			if (error.response?.status === 429) {
				const waitTime = Math.pow(2, attempts) * 1000; // Exponential backoff
				logger.warn(`Rate limited, waiting ${waitTime}ms before retry`);
				await sleep(waitTime);
				continue;
			}

			if (attempts === maxAttempts) {
				throw error;
			}

			logger.error(
				`Request failed, attempt ${attempts}/${maxAttempts}: ${error.message}`
			);
			await sleep(1000 * attempts);
		}
	}

	throw new Error("Max retry attempts reached");
}

export async function getUserDetails(identifier) {
	const url = `${API_BASE}/user/details`;
	const params = identifier;
	const response = await makeRequest(url, params);
	logger.debug(`User Details: ${JSON.stringify(response, null, 2)}`);
	return { ...response, user_id: response.user_id.toString() };
}

export async function getUserTweets(identifier, limit = 100) {
	const url = `${API_BASE}/user/tweets`;
	const params = identifier.user_id
		? {
				...identifier,
				user_id: identifier.user_id.toString(),
				limit,
				include_replies: false,
				include_pinned: false,
		  }
		: {
				...identifier,
				limit,
				include_replies: false,
				include_pinned: false,
		  };

	const response = await makeRequest(url, params);
	return response.results.map((tweet) => ({
		...tweet,
		tweet_id: tweet.tweet_id.toString(),
	}));
}

export async function getFollowing(user_id, maxLimit = 2500) {
	const urlOg = `${API_BASE}/user/following`;
	const urlCon = urlOg + "/continuation";
	const limit = 100;
	const allFollowing = [];
	let continuation_token = "";
	let url = urlOg;

	while (allFollowing.length < maxLimit) {
		if (continuation_token) {
			url = urlCon;
		}
		const params = {
			user_id: user_id.toString(),
			limit,
			continuation_token,
		};

		const response = await makeRequest(url, params);
		if (!response.results || response.results.length === 0) break;

		const normalizedUsers = response.results.map((user) => ({
			...user,
			user_id: user.user_id.toString(),
		}));

		allFollowing.push(...normalizedUsers);
		logger.debug(
			`Fetched ${normalizedUsers.length} more following, total: ${allFollowing.length}`
		);

		continuation_token = response.continuation_token;

		// Small delay between pagination requests
		await sleep(1000);
	}

	return allFollowing;
}
