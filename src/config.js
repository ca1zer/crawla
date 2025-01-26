import dotenv from "dotenv";

dotenv.config();

export const config = {
	minFollowers: parseInt(process.env.MIN_FOLLOWERS || "5000"),
	maxDepth: parseInt(process.env.MAX_DEPTH || "3"),
	refreshHours: Infinity,
	niche: process.env.NICHE,
};
