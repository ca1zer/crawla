export class TokenBucket {
	constructor(refillRate, capacity) {
		this.tokens = capacity;
		this.lastRefill = Date.now();
		this.refillRate = refillRate;
		this.capacity = capacity;
	}

	refill() {
		const now = Date.now();
		const timePassed = (now - this.lastRefill) / 1000; // Convert to seconds
		const newTokens = timePassed * this.refillRate;

		this.tokens = Math.min(this.capacity, this.tokens + newTokens);
		this.lastRefill = now;
	}

	async consume() {
		this.refill();

		if (this.tokens < 1) {
			// Calculate time until next token
			const timeUntilNextToken = ((1 - this.tokens) / this.refillRate) * 1000;
			await new Promise((resolve) => setTimeout(resolve, timeUntilNextToken));
			this.refill();
		}

		this.tokens -= 1;
	}
}

// Global rate limiter instance
export const apiRateLimiter = new TokenBucket(10, 10); // 10 requests per second, burst of 10
