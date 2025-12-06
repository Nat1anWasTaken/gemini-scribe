export interface SRTLine {
  id: number;
  startTime: number; // in seconds
  endTime: number; // in seconds
  text: string;
}

export interface ChunkResult {
  lines: Array<{ start: string; end: string; text: string }>;
  summary: string;
}

export interface AudioChunk {
  blob: Blob;
  startTime: number; // Absolute start time in the original file (seconds)
  endTime: number; // Absolute end time (seconds)
  index: number;
  totalChunks: number;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  DECODING = 'DECODING',
  TRANSCRIBING = 'TRANSCRIBING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}
