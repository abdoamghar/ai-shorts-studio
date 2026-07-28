import "server-only";
import { z } from "zod";

import { chatJson, LlmClientError } from "@/lib/llm/client";

/**
 * LLM localization: English (or other source) Shorts copy → natural MSA Arabic.
 *
 * Used only by the Arabic subtitle path. Does not touch English karaoke.
 * Translates clip metadata + subtitle lines 1:1 (same count / timing indices).
 */

export const LocalizeLineSchema = z.object({
  startMs: z.number(),
  endMs: z.number(),
  text: z.string(),
});

export const LocalizeClipInputSchema = z.object({
  title: z.string(),
  hook: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  hashtags: z.array(z.string()).default([]),
  lines: z.array(LocalizeLineSchema),
});

export type LocalizeClipInput = z.infer<typeof LocalizeClipInputSchema>;

// Schema is intentionally permissive — the LLM produces wildly varying
// shapes (missing title, lines as `[null, "text"]`, lines as a string, fields
// as numbers/objects, the whole thing truncated mid-array when tokens run out).
// We try to coerce everything in post-parse below; the schema should never
// REJECT the response — that would throw away a perfectly good 19/20-line or
// 87/88-line translation. Capture the raw object via z.unknown() and pass it
// downstream for coercion.
export const LocalizeClipOutputSchema = z.unknown();

export type LocalizeClipOutput = {
  title: string;
  hook: string | null;
  summary: string | null;
  hashtags: string[];
  lines: Array<{ startMs: number; endMs: number; text: string }>;
};

export type LocalizeStatusFn = (message: string) => void;

const SYSTEM = `You are a PROFESSIONAL Arabic localization specialist for short-form vertical video (TikTok / YouTube Shorts / Instagram Reels).
You produce natural, native-sounding Modern Standard Arabic (MSA) — with a punchy, shareable Shorts voice. You are NOT a literal translator; you are a localizer.

═══════════════════════════════════════════
CORE TRANSLATION RULES
═══════════════════════════════════════════
1. Never translate word-for-word. Reshape sentences so they sound like a native Arabic speaker wrote them — not a translated script.
2. Preserve meaning. Do NOT invent facts, numbers, speaker claims, or emotional beats that the source did not state. Tone may intensify; facts may not.
3. Match the speaker's register: casual dialogue stays casual (colloquial-flavored MSA), narration stays elevated, voiceover stays crisp, hooks stay scroll-stopping.
4. Keep subtitle lines TELEVISION-GRADE SHORT — under ~30 Arabic characters per line. If a source line is long, compress it; if short, keep it short. Do NOT pad with filler.
5. Preserve the same number of subtitle line OBJECTS as the input, in the same order. Each output line corresponds to ONE input line. Never split, merge, add, drop, or rearrange lines.
6. ZERO empty output. Every line in your response MUST contain visible Arabic text (or a kept-proper-noun). If a source line is borderline untranslatable, paraphrase briefly in Arabic — never return "" or whitespace.
7. Keep timing-independence: do NOT echo startMs/endMs in your output. Only "text" per line object.

═══════════════════════════════════════════
RTL PUNCTUATION & LAYOUT (CRITICAL — this is the most-common LLM bug)
═══════════════════════════════════════════
Arabic is RIGHT-TO-LEFT. Punctuation marks have inherent directionality in Unicode, and a wrong-direction glyph visually flips to the wrong side of the line when rendered.

8. USE ARABIC-SCRIPT PUNCTUATION, NOT LATIN:
   • Comma: use "،" (U+060C) — NEVER "," (U+002C)
   • Semicolon: use "؛" (U+061B) — NEVER ";"
   • Question mark: use "؟" (U+061F) — NEVER "?"
   • These RTL-aware glyphs render on the correct visual side in libass with \an5 + \an7 anchors.
9. Keep these marks in their RTL positions:
   • Period "." stays at the END of the Arabic sentence — when libass shapes the line, it sits to the far LEFT of the visual line (end of RTL reading order). Do not insert a space before it.
   • Exclamation "!" — Arabic context accepts it; place it at the end of the Arabic sentence (visually appears on the LEFT). No space before.
   • Quotation marks: prefer Arabic guillemets "«...»" (U+00AB / U+00BB) for quote framing. Avoid "..." (Latin quotes) because they render as logical-LTR pairs and reverse on screen.
   • Colons ":" — Arabic allows the Latin colon; no need to localize.
   • Hyphens/dashes "‐" "—" — keep as in source.
   • Parens "( )" — Arabic allows them; their directionality is mirrored in RTL by the bidi algorithm. Do not flip them yourself.
10. NEVER wrap numbers or Latin proper nouns in Arabic context with a stray Latin space (" "). Use Arabic-space (" ", same glyph) — the bidi algorithm handles Latin-script runs INSIDE Arabic automatically; the issue is punctuation that LOSES its RTL position.
11. For Latin proper nouns the user should keep (URLs, brand names like "TheFableCottage.com", app names, English buzzwords like "TikTok"): PRESERVE them VERBATIM as the source spelled them, do NOT transliterate to Arabic letters, do NOT translate — they are recognized brand/term identities. Surround by Arabic punctuation only where the source had punctuation (e.g. keep "TheFableCottage.com" exact).
12. For HASHTAGS: keep English-recognized hashtags (#fyp etc.) as-is. Translate topical hashtags into Arabic (#قصة، #حكاية، #دروس) without the leading "#" — the calling code adds the # back when displayed. Hashtag text should be Arabic-only (no Latin mix) for translatable ones.

═══════════════════════════════════════════
METADATA LOCALIZATION
═══════════════════════════════════════════
13. "title": scroll-stopping Arabic Short-form title (under ~40 Arabic chars). Punchy, scroll-stopping. Do not use ALL-CAPS (Arabic has no caps). Question or strong declarative works well.
14. "hook": the very first on-screen attention-bait line in Arabic — short, punchy, often a question or bold claim.
15. "summary": 1–2 Arabic sentence summary of the clip. Natural MSA only; do not summarize like a textbook. Keep under ~120 Arabic chars.
16. "hashtags": array of STRINGS — each WITHOUT a leading "#". Mix Arabic topical hashtags with a few kept-English ones the source used (brand/fandom). 5–12 items.

═══════════════════════════════════════════
TONE & POLISH
═══════════════════════════════════════════
17. Use active voice. Prefer short Arabic verb forms. Avoid unnecessary ceremonial MSA — speak a viewer's MSA, not a news reader's.
18. Reject any rendering of English that switches fonts mid-line ("Clip " in the middle of an Arabic sentence): if you must cite an English word, fine — but keep observing the punctuation rules above.
19. Where the source has humor, sarcasm, shock, or warmth — preserve the FEELING, not the literal wording. Arabic has its own emotional register ( expressive particles like "يا له من...", "ما أشد...", rhetorical "أليس كذلك؟"). Use them sparingly so they keep punch.
20. DO NOT soften punches, DO NOT censor (unless the source itself was euphemistic). DO NOT add religious phrases or honorifics absent from the source.

═══════════════════════════════════════════
OUTPUT
═══════════════════════════════════════════
- Respond with a SINGLE JSON object, nothing else (no prose, no comments, no markdown fence).
- Schema (field types exactly):
  { "title": string, "hook": string|null, "summary": string|null, "hashtags": string[], "lines": [{ "text": string }] }
- lines MUST have exactly the same length as the input lines array.
- All text fields MUST be valid UTF-8 Arabic (or kept-proper-noun strings). No control chars, no leading/trailing whitespace except a single trailing period where the source had one.`;

function isTransientLlmError(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("timed out") ||
    msg.includes("429") ||
    msg.includes("resourceexhausted") ||
    msg.includes("rate limit") ||
    msg.includes("request limit") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

function isRateLimited(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("resourceexhausted") ||
    msg.includes("rate limit") ||
    msg.includes("request limit") ||
    msg.includes("503")
  );
}

/**
 * Localize one clip's metadata + subtitle lines into Arabic.
 * Timing is taken from the input lines (LLM only rewrites text).
 */
export async function localizeClipToArabic(
  input: LocalizeClipInput,
  onStatus?: LocalizeStatusFn,
): Promise<LocalizeClipOutput> {
  const payload = LocalizeClipInputSchema.parse(input);

  const user = [
    "Localize this Shorts clip into natural MSA Arabic.",
    "",
    "INPUT JSON:",
    JSON.stringify(
      {
        title: payload.title,
        hook: payload.hook ?? null,
        summary: payload.summary ?? null,
        hashtags: payload.hashtags,
        lines: payload.lines.map((l, i) => ({
          index: i,
          text: l.text,
        })),
      },
      null,
      2,
    ),
    "",
    "OUTPUT JSON schema:",
    JSON.stringify(
      {
        title: "string",
        hook: "string|null",
        summary: "string|null",
        hashtags: ["string"],
        lines: [{ text: "string" }],
      },
      null,
      2,
    ),
    "",
    `You MUST return exactly ${payload.lines.length} items in "lines".`,
  ].join("\n");

  const MAX_ATTEMPTS = 3;
  let lastError: Error | null = null;
  let resultJson: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      onStatus?.(
        attempt > 1
          ? `LLM localize attempt ${attempt}/${MAX_ATTEMPTS}…`
          : "Waiting for LLM localization…",
      );
      const result = await chatJson([{ role: "user", content: user }], {
        system: SYSTEM,
        temperature: 0.35,
        // 88-line clips can need 3-5k tokens of Arabic alone; the default 4096
        // would truncate mid-array and break the parser. Cap high enough that
        // even a long clip's translation fits comfortably in one completion.
        maxTokens: 8192,
        onHeartbeat: (elapsedMs) => {
          const sec = Math.round(elapsedMs / 1000);
          onStatus?.(`Waiting for LLM… ${sec}s`);
        },
      });
      resultJson = result.json;
      lastError = null;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message;
      if (!isTransientLlmError(msg) || attempt === MAX_ATTEMPTS) {
        throw lastError instanceof LlmClientError
          ? lastError
          : new Error(`Arabic localization failed: ${msg}`);
      }
      const delaySec = isRateLimited(msg) ? attempt * 20 : attempt * 5;
      onStatus?.(
        `Localization rate-limited/transient error — waiting ${delaySec}s (attempt ${attempt}/${MAX_ATTEMPTS})…`,
      );
      await new Promise((r) => setTimeout(r, delaySec * 1000));
    }
  }

  if (lastError || resultJson == null) {
    throw lastError ?? new Error("Arabic localization failed after retries.");
  }

  const parsed = LocalizeClipOutputSchema.safeParse(resultJson);
  if (!parsed.success) {
    // Unreachable: schema is z.unknown(), so any value parses.
    const preview =
      typeof resultJson === "string"
        ? resultJson.slice(0, 200)
        : JSON.stringify(resultJson).slice(0, 200);
    throw new Error(
      `Arabic localization returned invalid JSON: ${parsed.error.issues[0]?.message ?? "parse failed"}. Preview: ${preview}`,
    );
  }
  const r = parsed.data;
  // If the LLM returned anything that isn't a plain object (string, array,
  // null, number, bool), there's nothing structured to coerce; we fall back to
  // the source payload entirely. This happens when the LLM returned prose like
  // "I can't translate that" or got truncated to just an opening brace.
  const raw: Record<string, unknown> =
    r && typeof r === "object" && !Array.isArray(r)
      ? (r as Record<string, unknown>)
      : {};

  // Coerce everything into a usable shape. Always falls back to the source
  // payload when the LLM omitted or mishandled a field — we never prefer the
  // LLM output over having *something* Arabic on screen.
  const coerceString = (v: unknown, fallback: string): string => {
    if (typeof v === "string") return v;
    if (v == null) return fallback;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    // Object/arrays in a string slot usually mean the LLM nested the data —
    // fall back rather than stringifying garbage.
    return fallback;
  };
  const coerceStringArray = (v: unknown): string[] => {
    if (Array.isArray(v)) {
      return v
        .map((x) => (typeof x === "string" ? x : x == null ? "" : String(x)))
        .filter((s) => s.length > 0);
    }
    if (typeof v === "string" && v.trim()) return [v.trim()];
    return [];
  };
  // Lines: accept several shapes the LLM might produce:
  //   [{text: "..."}]                  (expected)
  //   ["...", "..."]                   (bare strings)
  //   [{line: "..."}, {value: "..."}]  (LLM renamed the field)
  //   null / [] / missing              (use source lines)
  const coerceLines = (v: unknown): string[] => {
    if (!Array.isArray(v)) return [];
    const out: string[] = [];
    for (const item of v) {
      if (item == null) { out.push(""); continue; }
      if (typeof item === "string") { out.push(item); continue; }
      if (typeof item === "object") {
        const obj = item as Record<string, unknown>;
        const candidate =
          obj.text ?? obj.line ?? obj.value ?? obj.ar ?? obj.arabic ??
          obj.content ?? obj.subtitle;
        if (typeof candidate === "string") { out.push(candidate); continue; }
        if (candidate != null) { out.push(String(candidate)); continue; }
      }
      out.push("");
    }
    return out;
  };
  const arLines = coerceLines(raw.lines);
  const arHashtags = coerceStringArray(raw.hashtags);
  const arTitle = coerceString(raw.title, payload.title);
  const arHook = coerceString(raw.hook, payload.hook ?? "").trim() || null;
  const arSummary = coerceString(raw.summary, payload.summary ?? "").trim() || null;

  return {
    title: arTitle.trim() || payload.title,
    hook: arHook,
    summary: arSummary,
    hashtags: arHashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean),
    lines: payload.lines.map((src, i) => ({
      startMs: src.startMs,
      endMs: src.endMs,
      // Fall back to the source line when the LLM omitted / blanked this row.
      text: (arLines[i] ?? src.text).trim() || src.text,
    })),
  };
}
