import {
  GoogleGenAI,
  Type,
  Schema,
  HarmCategory,
  HarmBlockThreshold,
} from "@google/genai";
import { ChunkResult } from "../types";

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

// Schema definition for the expected JSON output
const outputSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          start: {
            type: Type.STRING,
            description: "Start time (Format: MM:SS.mmm, e.g. 00:00.000)",
          },
          end: {
            type: Type.STRING,
            description: "End time (Format: MM:SS.mmm, e.g. 00:05.123)",
          },
          text: { type: Type.STRING, description: "The transcribed text" },
        },
        required: ["start", "end", "text"],
      },
    },
    summary: {
      type: Type.STRING,
      description:
        "A summary of the events and context in this audio segment, to be used for the next segment's context.",
    },
  },
  required: ["lines", "summary"],
};

export async function transcribeChunk(
  base64Audio: string,
  description: string,
  previousSummary: string,
  modelId: string,
  onChunk: (text: string) => void,
  onThinking?: (text: string) => void,
  abortSignal?: AbortSignal,
): Promise<ChunkResult> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");

  if (abortSignal?.aborted) {
    throw new Error("Transcription aborted by user");
  }

  const ai = new GoogleGenAI({ apiKey });
  const resolvedModelId = modelId.trim() || "gemini-3-pro-preview";

  const prompt = `
    You are an expert transcriber and subtitler.

    Task:
    1. Listen to the audio and generate subtitle lines.
    2. Follow the "Transcription/Translation Instructions" below.
    3. Provide a summary of the content.
    4. Return precise timestamps relative to the start of this specific audio file.
    5. Continue transcribing until the very end of this audio clip. If content is faint or unclear near the end, make your best effort to capture it rather than stopping early.

    Transcription/Translation Instructions:
    "${description}"

    Previous Context:
    "${previousSummary || "This is the beginning of the audio."}"

    Important Constraints:
    - The audio file starts at 00:00.000.
    - **STRICT TIMESTAMP FORMAT**: You MUST use "MM:SS.mmm" (Minutes:Seconds.Milliseconds).
    - Example: "00:01.500" (correct), "1.5s" (incorrect), "00:01" (incorrect).
    - Ensure start and end times are strictly within the audio duration.
  `;

  try {
    const response = await ai.models.generateContentStream({
      model: resolvedModelId,
      contents: [
        {
          parts: [
            { inlineData: { mimeType: "audio/wav", data: base64Audio } },
            { text: prompt },
          ],
        },
      ],
      config: {
        maxOutputTokens: 65536,
        responseMimeType: "application/json",
        responseSchema: outputSchema,
        temperature: 0.2,
        safetySettings: safetySettings,

        thinkingConfig: {
          includeThoughts: true,
        },
      },
    });

    let fullText = "";

    for await (const chunk of response) {
      if (abortSignal?.aborted) {
        throw new Error("Transcription aborted by user");
      }

      const parts = chunk.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        // Thought summaries come back with part.thought === true and the
        // summary text is in part.text. These should NOT be added to the
        // final JSON body or streamed into the "Live Model Output" channel.
        if (part.thought && part.text) {
          onThinking?.(part.text);
          continue;
        }

        // Only non-thought parts belong to the JSON response stream.
        if (part.text) {
          fullText += part.text;
          onChunk(part.text);
        }
      }
    }

    if (!fullText) throw new Error("No response text generated");

    return JSON.parse(fullText) as ChunkResult;
  } catch (error) {
    console.error("Gemini 3 Pro Transcription Error:", error);
    throw error;
  }
}

export async function autoFixSummary(
  currentSummary: string,
  instructions: string,
  userPrompt: string,
  modelId: string,
): Promise<string> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");

  const ai = new GoogleGenAI({ apiKey });
  const resolvedModelId = modelId.trim() || "gemini-3-pro-preview";
  const guidance =
    userPrompt.trim() ||
    "Rewrite the summary so it avoids triggering safety filters but still preserves the key context for the next chunk.";

  const prompt = `You are sanitizing a context summary that is used to guide the next transcription chunk.

User provided guidance (apply faithfully):
${guidance}

Transcription / translation instructions for the overall task:
${instructions || "(none provided)"}

Current summary that may be tripping safety filters:
${currentSummary || "(empty)"}

Rewrite the summary so it keeps essential context but is safer and neutral. Return ONLY the rewritten summary text, no explanations or bullet points.`;

  const response = await ai.models.generateContent({
    model: resolvedModelId,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      temperature: 0.3,
      maxOutputTokens: 8192,
      safetySettings: safetySettings,
    },
  });

  const candidates =
    (response as any)?.response?.candidates ||
    (response as any)?.candidates ||
    [];
  const textParts = candidates?.[0]?.content?.parts || [];
  const combined = textParts
    .map((part) => part.text || "")
    .join("")
    .trim();

  if (!combined) {
    throw new Error("Auto-fix did not return a summary");
  }

  return combined;
}
