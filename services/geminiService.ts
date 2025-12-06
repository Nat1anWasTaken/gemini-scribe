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
          start: { type: Type.STRING, description: "Start time of the subtitle line (e.g. 00:00.000)" },
          end: { type: Type.STRING, description: "End time of the subtitle line (e.g. 00:05.000)" },
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
  onChunk: (text: string) => void
): Promise<ChunkResult> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key not found in environment variables");
  }

  const ai = new GoogleGenAI({ apiKey });
  
  // Using gemini-3-pro-preview as requested for complex reasoning + audio
  const modelId = "gemini-3-pro-preview";

  const prompt = `
    You are an expert transcriber and subtitler. 
    
    Task:
    1. Listen to the audio and generate subtitle lines.
    2. Follow the specific "Transcription/Translation Instructions" below (e.g., if it says "Japanese to Chinese", translate the spoken Japanese to Chinese text).
    3. Provide a summary of the content to establish context for the next segment.
    4. Return precise timestamps relative to the start of this specific audio file (starts at 00:00.000).

    Transcription/Translation Instructions:
    "${description}"

    Previous Context (what happened before this clip):
    "${previousSummary || "This is the beginning of the audio."}"

    Important:
    - The audio might cut off mid-sentence at the very end. Transcribe everything you hear.
    - Timestamps format: MM:SS.mmm
  `;

  try {
    const response = await ai.models.generateContentStream({
      model: modelId,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "audio/wav",
              data: base64Audio
            }
          },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: outputSchema,
        temperature: 0.2, // Low temperature for factual transcription
      }
    });

    let fullText = "";
    for await (const chunk of response) {
      const chunkText = chunk.text;
      if (chunkText) {
        fullText += chunkText;
        onChunk(chunkText);
      }
    }

    if (!fullText) throw new Error("No response text generated");

    const result = JSON.parse(fullText) as ChunkResult;
    return result;

  } catch (error) {
    console.error("Gemini Transcription Error:", error);
    throw error;
  }
}