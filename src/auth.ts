/**
 * MCP endpoint authentication.
 *
 * The server authenticates every MCP request with a bearer token
 * (`MCP_AUTH_TOKEN`). The comparison hashes both values first and then walks
 * the digests with an XOR accumulator so the check does not leak the token
 * length or the position of the first mismatching byte through timing.
 */

const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
	return new Uint8Array(digest);
}

/** Constant-time-ish comparison of two secrets. */
export async function secretsMatch(candidate: string, expected: string): Promise<boolean> {
	const [a, b] = await Promise.all([sha256(candidate), sha256(expected)]);
	let diff = 0;
	for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
	return diff === 0;
}

/** Extracts the token from `Authorization: Bearer <token>`. */
export function bearerToken(request: Request): string | null {
	const header = request.headers.get("Authorization");
	if (!header) return null;
	const match = /^Bearer\s+(.+)$/i.exec(header.trim());
	return match ? match[1].trim() : null;
}

export async function isAuthorized(request: Request, expected: string | null): Promise<boolean> {
	if (!expected) return false;
	const token = bearerToken(request);
	if (!token) return false;
	return secretsMatch(token, expected);
}
