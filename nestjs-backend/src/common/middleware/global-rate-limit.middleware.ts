export function shouldEnableGlobalRateLimit(): boolean {
	return false;
}

export function createGlobalRateLimiter() {
	return (req: any, res: any, next: any) => next();
}
