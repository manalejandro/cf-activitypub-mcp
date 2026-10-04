import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { fail, run } from "../result";
import type { ToolContext } from "../context";

const MAX_EMOJI_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Map<string, string>([
	["image/png", "png"],
	["image/gif", "gif"],
	["image/webp", "webp"],
]);

/**
 * Custom emoji management. Uploads accept either a public image URL or a
 * base64 payload; the instance stores the object in R2.
 */
export function registerEmojiTools(server: McpServer, ctx: ToolContext): string[] {
	server.registerTool(
		"list_emojis",
		{
			title: "List custom emojis",
			description: "Lists all custom emojis, including disabled ones.",
			inputSchema: z.object({}),
		},
		async () => run(() => ctx.admin().get("/api/admin/emojis"))
	);

	server.registerTool(
		"manage_emoji",
		{
			title: "Manage custom emoji",
			description:
				"Uploads, enables/disables or deletes a custom emoji. `upload` needs a `shortcode` and either `image_url` (public HTTPS image) or `image_base64`; PNG, GIF and WebP up to 2 MB are accepted. `update` toggles `disabled` for an existing `emoji_id`. `delete` permanently removes it and requires `confirm: true`.",
			inputSchema: z.object({
				action: z.enum(["upload", "update", "delete"]).describe("Operation to perform."),
				shortcode: z
					.string()
					.optional()
					.describe("Emoji shortcode (letters, numbers and underscores). Required for `upload`."),
				category: z.string().optional().describe("Optional emoji category."),
				image_url: z.string().optional().describe("Public HTTPS image URL. Alternative to `image_base64`."),
				image_base64: z
					.string()
					.optional()
					.describe("Base64-encoded image bytes (optionally a data: URL). Alternative to `image_url`."),
				content_type: z
					.enum(["image/png", "image/gif", "image/webp"])
					.optional()
					.describe("Image MIME type. Inferred from the payload when omitted."),
				emoji_id: z.string().optional().describe("Emoji id. Required for `update` and `delete`."),
				disabled: z.boolean().optional().describe("New disabled state. Required for `update`."),
				confirm: z.boolean().default(false).describe("Must be `true` for `delete`."),
			}),
		},
		async (args) => {
			const { action, shortcode, category, image_url, image_base64, content_type, emoji_id, disabled, confirm } =
				args;

			if (action === "delete") {
				if (confirm !== true) {
					return fail("`delete` is destructive. Call manage_emoji again with confirm: true to proceed.");
				}
				if (!emoji_id) return fail("`emoji_id` is required when action is `delete`.");
				return run(() => ctx.admin().delete(`/api/admin/emojis/${encodeURIComponent(emoji_id)}`));
			}

			if (action === "update") {
				if (!emoji_id) return fail("`emoji_id` is required when action is `update`.");
				if (typeof disabled !== "boolean") return fail("`disabled` is required when action is `update`.");
				return run(() =>
					ctx.admin().patch(`/api/admin/emojis/${encodeURIComponent(emoji_id)}`, { disabled })
				);
			}

			// upload
			if (!shortcode || !/^[a-zA-Z0-9_]+$/.test(shortcode)) {
				return fail("`shortcode` is required and may only contain letters, numbers and underscores.");
			}
			if (!image_url && !image_base64) {
				return fail("Provide either `image_url` or `image_base64` to upload an emoji.");
			}
			return run(async () => {
				const image = image_url
					? await fetchImage(image_url)
					: decodeBase64Image(image_base64!, content_type);
				if (content_type && image.type !== content_type) {
					image.type = content_type;
				}
				const extension = ALLOWED_TYPES.get(image.type);
				if (!extension) {
					throw new Error(
						`Unsupported image type \`${image.type}\`. Use PNG, GIF or WebP.`
					);
				}
				if (image.bytes.byteLength > MAX_EMOJI_BYTES) {
					throw new Error(`The image is larger than 2 MB (${image.bytes.byteLength} bytes).`);
				}

				const form = new FormData();
				form.append("shortcode", shortcode.toLowerCase());
				if (category) form.append("category", category);
				form.append("file", new Blob([image.bytes], { type: image.type }), `${shortcode}.${extension}`);

				return ctx.admin().postForm("/api/admin/emojis", form);
			});
		}
	);

	return ["list_emojis", "manage_emoji"];
}

interface DecodedImage {
	bytes: Uint8Array;
	type: string;
}

async function fetchImage(url: string): Promise<DecodedImage> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`\`image_url\` is not a valid URL: ${url}`);
	}
	if (parsed.protocol !== "https:") {
		throw new Error("`image_url` must use HTTPS.");
	}
	const response = await fetch(parsed, { signal: AbortSignal.timeout(15_000) });
	if (!response.ok) {
		throw new Error(`Could not download the image (HTTP ${response.status}).`);
	}
	const declaredLength = Number(response.headers.get("Content-Length") ?? "0");
	if (declaredLength > MAX_EMOJI_BYTES) {
		throw new Error(`The image is larger than 2 MB (${declaredLength} bytes).`);
	}
	const type = (response.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > MAX_EMOJI_BYTES) {
		throw new Error(`The image is larger than 2 MB (${bytes.byteLength} bytes).`);
	}
	return { bytes, type: type || detectImageType(bytes) || "application/octet-stream" };
}

function decodeBase64Image(input: string, declared?: string): DecodedImage {
	const dataUrlMatch = /^data:([^;,]+);base64,(.*)$/s.exec(input);
	const type = declared ?? dataUrlMatch?.[1] ?? "";
	const base64 = (dataUrlMatch ? dataUrlMatch[2] : input).replace(/\s+/g, "");
	if (Math.ceil((base64.length * 3) / 4) > MAX_EMOJI_BYTES) {
		throw new Error("The image is larger than 2 MB.");
	}
	let binary: string;
	try {
		binary = atob(base64);
	} catch {
		throw new Error("`image_base64` is not valid base64 data.");
	}
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return { bytes, type: type || detectImageType(bytes) || "application/octet-stream" };
}

/** Sniffs PNG/GIF/WebP magic bytes. */
function detectImageType(bytes: Uint8Array): string | null {
	if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		return "image/png";
	}
	if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
		return "image/gif";
	}
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return "image/webp";
	}
	return null;
}
