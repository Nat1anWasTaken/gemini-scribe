import { GoogleGenAI, Type, Schema } from "@google/genai";
import { ChunkResult } from "../types";

// Schema definition for the expected JSON output
const outputSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    lines: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          start: { type: Type.STRING, description: "Start time (Format: MM:SS.mmm, e.g. 00:00.000)" },
          end: { type: Type.STRING, description: "End time (Format: MM:SS.mmm, e.g. 00:05.123)" },
          text: { type: Type.STRING, description: "The transcribed text" }
        },
        required: ["start", "end", "text"]
      }
    },
    summary: {
      type: Type.STRING,
      description: "A summary of the events and context in this audio segment, to be used for the next segment's context."
    }
  },
  required: ["lines", "summary"]
};

export async function transcribeChunk(
  base64Audio: string,
  description: string,
  previousSummary: string,
  onChunk: (text: string) => void,
  onThinking?: (text: string) => void
): Promise<ChunkResult> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");

  const ai = new GoogleGenAI({ apiKey });
  
  const modelId = "gemini-3-pro-preview";

  const prompt = `
    You are an expert transcriber and subtitler.
    
    Task:
    1. Listen to the audio and generate subtitle lines.
    2. Follow the "Transcription/Translation Instructions" below.
    3. Provide a summary of the content.
    4. Return precise timestamps relative to the start of this specific audio file.

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
      model: modelId,
      contents: [
        {
          parts: [
            { inlineData: { mimeType: "audio/wav", data: base64Audio } },
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: outputSchema,
        temperature: 0.2,
        
        thinkingConfig: {
          includeThoughts: true
        }
      }
    });

    let fullText = "";

    for await (const chunk of response) {
      const parts = chunk.candidates?.[0]?.content?.parts || [];

      for (const part of parts) {
        // 解析思考過程 (Streamed Thoughts)
        if (part.thought) {
          onThinking?.(part.thought);
        }

        // 解析最終 JSON (Actual Response)
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
