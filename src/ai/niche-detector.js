import OpenAI from "openai";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { logger } from "../utils/logger.js";

const responseSchema = z.object({ isNiche: z.boolean() });

export class NicheDetector {
	constructor(niche) {
		this.openai = new OpenAI({
			apiKey: process.env.OPENAI_API_KEY,
		});
		this.niche = niche;
	}

	async isUserInNiche(user, tweets) {
		const userInfo = {
			username: user.username,
			name: user.name,
			bio: user.description || "",
			followerCount: user.follower_count,
			tweets: tweets.slice(0, 20).map((t) => ({
				text: t.text,
			})),
		};

		try {
			const response = await this.openai.beta.chat.completions.parse({
				model: "gpt-4o-mini",
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: `Analyze if this Twitter user is part of the ${
									this.niche
								} niche.
Consider:
- Their bio/description and name
- Tweet content and topics
- Professional indicators
- Industry terminology usage
- Engagement levels on niche-related tweets
- Overall authenticity and expertise signals

Here is the user data to analyze:
${JSON.stringify(userInfo, null, 2)}`,
							},
						],
					},
				],
				response_format: zodResponseFormat(responseSchema, "responseSchema"),
			});

			const result = JSON.parse(response.choices[0].message.content);
			logger.debug(`Niche detection for ${user.username}: ${result.isNiche}`);
			return result.isNiche;
		} catch (error) {
			logger.error(`Error detecting niche for user ${user.username}:`, error);
			return false;
		}
	}
}
