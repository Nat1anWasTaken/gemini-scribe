import { encodeWAV } from './wavEncoder';
import { AudioChunk } from '../types';

// Constants
const TARGET_SAMPLE_RATE = 16000; // 16kHz is sufficient for speech and saves tokens/bandwidth
const CHUNK_DURATION_SEC = 600; // 10 minutes
const OVERLAP_SEC = 10; // 10 seconds buffer

/**
 * Decodes an audio file, resamples it to 16kHz Mono, and splits it into chunks.
 */
export async function processAudioFile(
  file: File, 
  onProgress: (msg: string) => void
): Promise<AudioChunk[]> {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  
  onProgress("Reading file...");
  const arrayBuffer = await file.arrayBuffer();
  
  onProgress("Decoding audio data (this may take a moment)...");
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // We use OfflineAudioContext to resample and mix down to mono
  onProgress("Resampling to 16kHz Mono...");
  const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * TARGET_SAMPLE_RATE, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  
  const resampledBuffer = await offlineCtx.startRendering();
  const pcmData = resampledBuffer.getChannelData(0); // It's mono now

  onProgress("Splitting audio into chunks...");
  const chunks: AudioChunk[] = [];
  const totalSamples = pcmData.length;
  const chunkSamples = CHUNK_DURATION_SEC * TARGET_SAMPLE_RATE;
  const overlapSamples = OVERLAP_SEC * TARGET_SAMPLE_RATE;

  // Calculate total expected chunks
  // Step size is chunkSamples (no overlap in stepping, we add overlap to the *end* of the slice)
  // Actually, we step by CHUNK_DURATION_SEC. The 'chunk' we send to AI includes the overlap.
  const totalDuration = audioBuffer.duration;
  const totalChunkCount = Math.ceil(totalDuration / CHUNK_DURATION_SEC);

  for (let i = 0; i < totalChunkCount; i++) {
    const startSample = i * chunkSamples;
    // The end sample includes the buffer, unless it's the very last part
    let endSample = startSample + chunkSamples + overlapSamples;
    
    // Clamp to file end
    if (endSample > totalSamples) {
      endSample = totalSamples;
    }

    const slice = pcmData.slice(startSample, endSample);
    const wavBlob = encodeWAV(slice, TARGET_SAMPLE_RATE);

    chunks.push({
      blob: wavBlob,
      startTime: i * CHUNK_DURATION_SEC,
      endTime: (i * CHUNK_DURATION_SEC) + (slice.length / TARGET_SAMPLE_RATE), // Actual end time of this blob
      index: i,
      totalChunks: totalChunkCount
    });
  }

  onProgress(`Prepared ${chunks.length} chunks.`);
  return chunks;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}