// The AI-written note that opens each Bluesky post. No Worker imports: the worker and the backfill script call the
// model their own way and share the prompt and the clean-up.
import type { GhostPost } from "./bluesky-post";

export const NOTE_MODEL = "@cf/google/gemma-4-26b-a4b-it";
// With thinking on, Gemma spends its whole token budget reasoning and returns no text.
export const NOTE_OPTIONS = { max_tokens: 300, chat_template_kwargs: { enable_thinking: false } };
export const NOTE_MAX_GRAPHEMES = 240;
const ARTICLE_CHARS = 4000;

const SYSTEM = `You write the text of a Bluesky post that shares an article from Inovus Blogs, the blog of Inovus Labs, a student innovation community in Kerala.
Below the text, the post shows a link card with the article's title, excerpt, cover image, date and reading time.
Write a short, inviting description of the article, one or two sentences and at most 220 characters, that makes people want to read it: what it is about and what the reader gets from it, such as the story it tells, the question it answers, or what they will learn or build.
Rules:
- Ground it in what the article actually says, with at least one specific detail. Never invent facts, numbers or quotes.
- Don't repeat the title or copy the excerpt.
- Warm and natural, matching the article's tone; be careful with serious subjects. No clickbait, hype or empty praise such as "a must-read".
- Open with the subject itself, not a stock phrase: don't start with "Explore", "Learn", "Discover", "Dive into", "Find out" or "This article".
- Write in the same language as the article.
- No emoji, hashtags, @mentions, links or quotation marks.
Output only the description.`;

export function noteMessages(post: GhostPost, text: string) {
	const excerpt = (post.custom_excerpt || post.excerpt || "").trim();
	return [
		{ role: "system", content: SYSTEM },
		{
			role: "user",
			content: `Title: ${post.title}\nExcerpt: ${excerpt}\n\nArticle:\n${text.slice(0, ARTICLE_CHARS)}`,
		},
	];
}

/** Workers AI returns either `response` or an OpenAI-style `choices` array, depending on the model. */
export function noteText(result: unknown): string | undefined {
	const r = result as { response?: string; choices?: { message?: { content?: string | null } }[] };
	return r?.response ?? r?.choices?.[0]?.message?.content ?? undefined;
}

const segmenter = new Intl.Segmenter();

/** Strips what the prompt forbids; returns undefined when nothing usable is left. */
export function cleanNote(raw: string | null | undefined): string | undefined {
	const note = (raw ?? "")
		.replace(/<think>[\s\S]*?<\/think>/g, "")
		.replace(/\p{Extended_Pictographic}️?/gu, "")
		.replace(/https?:\/\/\S+|[#@][\p{L}\p{N}_.-]+/gu, "")
		.replace(/["“”«»]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!note) return;
	const chars = [...segmenter.segment(note)].map((g) => g.segment);
	if (chars.length <= NOTE_MAX_GRAPHEMES) return note;
	// Too long: keep whole sentences that fit, or give up rather than cut one mid-way.
	const kept = chars.slice(0, NOTE_MAX_GRAPHEMES).join("").match(/^.*[.!?।](?=\s|$)/s)?.[0];
	return kept?.trim() || undefined;
}
