export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function validateConfig(config) {
	const requiredEnvVars = ["RAPID_API_KEY"];
	const missingVars = requiredEnvVars.filter((v) => !process.env[v]);

	if (missingVars.length > 0) {
		throw new Error(
			`Missing required environment variables: ${missingVars.join(", ")}`
		);
	}

	if (!config.minFollowers || config.minFollowers < 0) {
		throw new Error("Invalid minFollowers config");
	}

	if (!config.maxDepth || config.maxDepth < 0) {
		throw new Error("Invalid maxDepth config");
	}

	if (!config.refreshHours || config.refreshHours < 0) {
		throw new Error("Invalid refreshHours config");
	}
}
