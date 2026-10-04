/**
 * Minimal typed client for the CF ActivityPub (cf-activitypub-next) HTTP API.
 *
 * Admin endpoints accept the shared `ADMIN_TOKEN` operator secret as a Bearer
 * token, which grants full administrator access — that is exactly what this
 * MCP server forwards. Public endpoints (instance metadata, search, nodeinfo)
 * work without a token.
 */

export class ApiError extends Error {
	readonly status: number;
	readonly details: unknown;

	constructor(status: number, message: string, details?: unknown) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.details = details;
	}
}

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigError";
	}
}

export interface RequestOptions {
	/** Query string parameters; `undefined` and `null` values are dropped. */
	query?: Record<string, string | number | boolean | undefined | null>;
	/** JSON request body. Ignored when `formData` is provided. */
	body?: unknown;
	/** Multipart body (emoji uploads). Takes precedence over `body`. */
	formData?: FormData;
	/** Per-request timeout in milliseconds (defaults to 30s). */
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class ActivityPubClient {
	readonly baseUrl: string;
	private readonly token: string | null;

	constructor(baseUrl: string, token?: string | null) {
		this.baseUrl = baseUrl.replace(/\/+$/, "");
		this.token = token?.trim() || null;
	}

	async request<T = unknown>(
		method: string,
		path: string,
		options: RequestOptions = {}
	): Promise<T> {
		const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
		if (options.query) {
			for (const [key, value] of Object.entries(options.query)) {
				if (value === undefined || value === null || value === "") continue;
				url.searchParams.set(key, String(value));
			}
		}

		const headers = new Headers({ Accept: "application/json" });
		if (this.token) headers.set("Authorization", `Bearer ${this.token}`);

		let body: BodyInit | undefined;
		if (options.formData) {
			body = options.formData;
		} else if (options.body !== undefined) {
			headers.set("Content-Type", "application/json");
			body = JSON.stringify(options.body);
		}

		let response: Response;
		try {
			response = await fetch(url, {
				method,
				headers,
				body,
				signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new ApiError(0, `Could not reach the ActivityPub instance at ${this.baseUrl}: ${reason}`);
		}

		const text = await response.text();
		const payload = parseBody(text);

		if (!response.ok) {
			throw new ApiError(response.status, extractErrorMessage(payload, response.status), payload);
		}

		return payload as T;
	}

	get<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
		return this.request<T>("GET", path, options);
	}

	post<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
		return this.request<T>("POST", path, { ...options, body });
	}

	put<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
		return this.request<T>("PUT", path, { ...options, body });
	}

	patch<T = unknown>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
		return this.request<T>("PATCH", path, { ...options, body });
	}

	delete<T = unknown>(path: string, options?: RequestOptions): Promise<T> {
		return this.request<T>("DELETE", path, options);
	}

	/** Uploads a binary object as multipart/form-data. */
	postForm<T = unknown>(path: string, form: FormData, options?: RequestOptions): Promise<T> {
		return this.request<T>("POST", path, { ...options, formData: form });
	}
}

function parseBody(text: string): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function extractErrorMessage(payload: unknown, status: number): string {
	if (payload && typeof payload === "object") {
		const record = payload as Record<string, unknown>;
		for (const key of ["error", "message", "detail"]) {
			if (typeof record[key] === "string" && record[key]) return record[key] as string;
		}
	}
	if (typeof payload === "string" && payload) return payload.slice(0, 300);
	return `The ActivityPub instance answered with HTTP ${status}`;
}
