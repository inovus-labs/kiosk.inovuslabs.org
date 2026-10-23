import { env } from "cloudflare:workers";
import { plainText } from "../standard-site";
import type { GhostPost } from "./platform";

const MODEL = "@cf/google/gemma-4-26b-a4b-it";

/** A platform's instructions for the model, and the clean-up of what it writes. */
export interface Prompt {
	system: string;
	/** How much of the article the model reads. */
	articleChars: number;
	maxTokens: number;
	/** Strips what the prompt forbids; undefined when nothing usable is left. */
	clean(raw: string): string | undefined;
}

export function messages(post: GhostPost, prompt: Prompt, text: string) {
	const excerpt = (post.custom_excerpt || post.excerpt || "").trim();
	return [
		{ role: "system", content: prompt.system },
		{ role: "user", content: `Title: ${post.title}\nExcerpt: ${excerpt}\n\nArticle:\n${text.slice(0, prompt.articleChars)}` },
	];
}

/** Workers AI returns either `response` or an OpenAI-style `choices` array, depending on the model. */
function responseText(result: unknown): string {
	const r = result as { response?: string; choices?: { message?: { content?: string | null } }[] };
	return (r?.response ?? r?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
}

// No text is better than a bad one: the post still goes out with its credit, tags and card.
export async function write(post: GhostPost, prompt: Prompt): Promise<string | undefined> {
	const text = post.plaintext?.trim() || (post.html ? plainText(post.html) : "");
	if (!text) return;
	try {
		const result = await env.AI.run(MODEL as keyof AiModels, {
			messages: messages(post, prompt, text),
			max_tokens: prompt.maxTokens,
			// With thinking on, Gemma spends its whole token budget reasoning and returns no text.
			chat_template_kwargs: { enable_thinking: false },
		} as never);
		return prompt.clean(responseText(result));
	} catch (error) {
		console.warn(`ai: no text for ${post.id}:`, error);
	}
}
