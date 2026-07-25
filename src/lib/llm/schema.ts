import { z } from "zod";

/**
 * The clip-candidate contract the LLM must return, and the human-readable JSON
 * schema description embedded in every prompt so the model returns the right
 * shape. Kept in one place so prompt templates, the validator, and the seeds
 * never drift apart.
 *
 * Top-level: { "clips": [ ClipCandidate, ... ] }
 */

export const ScoresSchema = z.object({
  hook: z.number().min(0).max(10),
  emotion: z.number().min(0).max(10),
  curiosity: z.number().min(0).max(10),
  shareability: z.number().min(0).max(10),
  retention: z.number().min(0).max(10),
  educational: z.number().min(0).max(10),
  overall: z.number().min(0).max(10),
});

export const ClipCandidateSchema = z.object({
  /** Display title for the clip. */
  title: z.string().min(1).max(140),
  /** Start time of the clip in SECONDS (source-absolute). */
  start: z.number().min(0),
  /** End time of the clip in SECONDS (source-absolute). */
  end: z.number().min(0),
  hook: z.string().max(280).optional(),
  summary: z.string().max(600).optional(),
  emotion: z.string().max(60).optional(),
  category: z.string().max(60).optional(),
  viralityScore: z.number().min(0).max(10).optional(),
  retentionScore: z.number().min(0).max(10).optional(),
  engagementScore: z.number().min(0).max(10).optional(),
  overallScore: z.number().min(0).max(10),
  hashtags: z.array(z.string().max(60)).max(12).default([]),
  keywords: z.array(z.string().max(60)).max(20).default([]),
  scores: ScoresSchema.optional(),
});

export type ClipCandidate = z.infer<typeof ClipCandidateSchema>;
export type ClipScores = z.infer<typeof ScoresSchema>;

export const LlmClipsResponseSchema = z.object({
  clips: z.array(ClipCandidateSchema),
});

/** The exact JSON shape the model must produce, embedded into every prompt. */
export const CLIP_JSON_CONTRACT = `{
  "clips": [
    {
      "title": string,            // punchy 3-7 word title for the short
      "start": number,            // start time in SECONDS, source-absolute
      "end": number,              // end time in SECONDS, source-absolute
      "hook": string,             // the opening line that grabs attention
      "summary": string,          // 1-2 sentence description of the moment
      "emotion": string,          // dominant emotion (e.g. "inspiration", "tension")
      "category": string,         // content category (e.g. "insight", "conflict", "quote")
      "viralityScore": number,    // 0-10 likelihood of being shared
      "retentionScore": number,   // 0-10 hook + pacing strength
      "engagementScore": number,  // 0-10 comment/interaction bait
      "overallScore": number,     // 0-10 your holistic ranking
      "hashtags": string[],       // up to 12 relevant hashtags (no #)
      "keywords": string[],       // up to 20 topical keywords
      "scores": {                 // the AI scoring rubric, each 0-10
        "hook": number,
        "emotion": number,
        "curiosity": number,
        "shareability": number,
        "retention": number,
        "educational": number,
        "overall": number
      }
    }
  ]
}`;

/** The scoring rubric instructions appended to every category prompt. */
export const SCORING_RUBRIC = `Score each clip on a 0-10 scale:
- hook: how strong the opening 1-3 seconds are
- emotion: intensity/transformation of feeling
- curiosity: does it make you want to hear the answer
- shareability: would someone forward it
- retention: pacing that keeps a viewer watching to the end
- educational: standalone informational value
- overall: your holistic judgment of how good a short this makes
Keep clips between {minSec}s and {maxSec}s. Times are in SECONDS and are source-absolute (not clip-relative).
Return only the JSON object above; do not include commentary or markdown.`;
