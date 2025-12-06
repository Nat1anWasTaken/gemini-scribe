# Gemini Scribe

Gemini Scribe is a Vite + React application for long-form audio transcription powered by Gemini 3 Pro. It splits large audio files into manageable chunks, preserves context between segments, and generates downloadable SRT subtitles with rich progress feedback.

## Features
- Upload large audio files (MP3, WAV, M4A) and automatically split them for processing.
- Streamed transcription using Gemini 3 Pro with contextual summaries between chunks.
- Retry handling for API calls and live log output to monitor progress.
- Generate and download SRT subtitle files with precise timestamps.

## Prerequisites
- Node.js 18 or later (enable Corepack if available to install pnpm)
- pnpm 9 or later
- A Gemini API key

This project uses pnpm for dependency management and scripts.

## Setup
1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Create an `.env.local` file in the project root and configure your environment variables (see **Environment variables**).
3. Start the development server:
   ```bash
   pnpm dev
   ```
4. Visit the printed local URL (defaults to `http://localhost:3000`).

## Environment variables
Create a `.env.local` file in the project root with the following values:

| Name | Required | Description |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | API key for Google Gemini. Used to authorize requests for transcription. |

Example `.env.local`:
```bash
GEMINI_API_KEY=your_api_key_here
```

## Scripts
- `pnpm dev` – Start the local development server.
- `pnpm build` – Build the production bundle.
- `pnpm preview` – Preview the production build locally.

## Deployment
Build the project before deploying to your hosting provider:
```bash
pnpm build
```
Serve the contents of the generated `dist/` directory using your preferred static host.
