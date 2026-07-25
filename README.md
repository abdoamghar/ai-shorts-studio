# AI Shorts Studio

Turn long YouTube videos (podcasts, interviews, debates, speeches) into **vertical, subtitle-burned clips** ready for TikTok / YouTube Shorts / Reels.

Paste a URL -> download -> transcribe -> LLM finds viral clips -> render 9:16 with burned captions -> preview & export. A single-user **local** app that feels like a polished SaaS.

## Prerequisites

- **Node.js** 20+ (tested on 24) and **npm** 10+
- **Python** 3.10+ on PATH (`python --version`)
- **ffmpeg** + **ffprobe** on PATH (the Gyan build recommended on Windows)
- **yt-dlp** on PATH
- **faster-whisper** Python package (`pip install faster-whisper`), CPU-only

On Windows the bundled setup script installs the binaries via `winget` and the Python package via `pip`:

```powershell
# from the shorts-app directory
npm run setup
# skip the whisper install if you already have it
npm run setup -- -SkipWhisper
```

Open a **new terminal** after the script finishes so PATH refreshes, then re-run `npm run setup` to confirm everything reports present.

> The app shows an amber banner at the top of every page listing any missing tools, with a one-click reminder to run `npm run setup`.

## Environment variables (optional)

All tooling is auto-resolved from PATH. Override a binary's location if it isn't on PATH (e.g. portable builds):

```
YT_DLP_PATH=C:\tools\yt-dlp.exe
FFMPEG_PATH=C:\tools\ffmpeg.exe
FFPROBE_PATH=C:\tools\ffprobe.exe
PYTHON_PATH=C:\Python312\python.exe
```

Drop these into a `.env` file at the repo root (gitignored). No API keys go in env - LLM provider config is entered on the **API Settings** page and stored AES-256-GCM encrypted in the local SQLite DB.

## Getting started

```bash
npm install
npm run dev          # http://localhost:3000
```

1. Open **API Settings**, pick your provider, enter a base URL + API key + model, and click **Test connection**.
2. Open the **Dashboard**, paste a YouTube URL, and click **Analyze Video**.
3. Watch progress on the **Processing Queue** (live SSE), then open the project to preview transcript, clips, the timeline, renders, and exports.

## npm scripts

- `npm run dev` - Next.js dev server (Turbopack)
- `npm run build` - production build
- `npm run start` - serve the production build
- `npm run typecheck` - `tsc --noEmit`
- `npm run lint` - ESLint
- `npm run setup` - install/verify yt-dlp + ffmpeg + faster-whisper (Windows)
- `npm run db:generate` - generate a new Drizzle migration from schema changes
- `npm run db:migrate` - apply pending migrations
- `npm run db:push` - push schema directly (dev)
- `npm run db:studio` - Drizzle Studio (browse the SQLite DB)

## How it works

```
URL -> yt-dlp (video.mp4 + info.json)
    -> ffmpeg (16kHz mono audio.wav)
    -> faster-whisper (word-timed transcript, CPU)
    -> OpenAI-compatible LLM (clip candidates + scores, JSON mode + zod)
    -> overlap de-dup + clip cap + sort by overallScore
    -> per-clip SRT + ASS subtitles (clip-relative, karaoke highlight)
    -> ffmpeg render: center-padded-blur 1080x1920 + burn ASS, libx264/aac
    -> renders persisted; per-clip + bulk-zip export (mp4/srt/ass/json)
```

Subtitle themes (TikTok / Hormozi / Minimal / Bold / Classic / MrBeast + your clones) are serialized to ASS `force_style`; the **Subtitle Themes** page previews a real sample frame via ffmpeg before you commit.

## Storage layout

Everything is local under the repo:

```
shorts-app/
  data/app.sqlite            # Drizzle/better-sqlite3 DB (projects, jobs, clips, renders, settings, themes, templates)
  storage/<projectId>/
    video.mp4                # source
    audio.wav                # 16kHz mono
    transcript.json          # word-level (also denormalized into DB)
    clips/                   # clip thumbnails (optional)
    subs/clip_NN.srt|.ass    # clip-relative subtitles
    renders/clip_NN.mp4      # 9:16 burned-subtitle output
  whisper-models/            # faster-whisper model cache (.gitignored)
```

## Tech stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript**
- **Tailwind CSS v4** (CSS-first, no config file) + **shadcn/ui** v4 (radix-nova) + **lucide-react**
- **Drizzle ORM** + **better-sqlite3** (swap to Postgres by changing the driver)
- In-process **JobRunner** with a SQLite-backed durable queue + **SSE** for live progress
- Single OpenAI-compatible **LLM client** (works with OpenAI, OpenRouter, DeepSeek, GLM, etc.)
- **faster-whisper** run as a Python subprocess for CPU-only transcription

## Troubleshooting

- **Everything errors with "was not found"** - a binary isn't on PATH. Run `npm run setup`, open a **new** terminal, and re-run. The amber banner names exactly what's missing.
- **Whisper transcribe step hangs/fails** - first run downloads a model (~150 MB for `base`); ensure `whisper-models/` is writable. Check the job log on the Processing Queue (`[transcribe]` lines).
- **LLM analysis returns no clips** - verify the API key/model on API Settings (Test connection), and try a different **Prompt Template** in project settings.
- **Render produces no output** - check the `[render]` job log; common cause is a missing `subs/clip_NN.ass` (subtitles step failed) or ffmpeg path escaping on Windows (handled internally; relative paths are used to avoid drive-letter colons).
- **PATH not refreshed after `winget` install** - `winget` updates the Machine/User PATH but not the current shell. Open a new terminal.

## Notes

- v1 is single-user local: no auth, no S3 - multi-user and cloud storage are structured as drop-in additions (see the `StorageProvider` interface and the settings encryption layer).
- Heavy jobs run sequentially (concurrency = 1) to keep your laptop responsive. Whisper is CPU-only and roughly real-time for the `base` model.
