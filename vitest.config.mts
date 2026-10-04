import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// The Sentinel Durable Object keeps the Workers runtime alive briefly
		// after the suite finishes; don't wait the default 10s for close.
		teardownTimeout: 2_000,
	},
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
		}),
	],
});
