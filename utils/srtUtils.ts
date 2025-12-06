import { SRTLine } from '../types';

/**
 * Converts seconds to SRT timestamp format (HH:MM:SS,mmm)
 */
function formatSRTTimestamp(seconds: number): string {
  const date = new Date(0);
  date.setMilliseconds(seconds * 1000);
  const isoString = date.toISOString().substr(11, 12);
  return isoString.replace('.', ',');
}

/**
 * Parses Gemini timestamp "MM:SS.mmm" or "HH:MM:SS.mmm" to seconds
 */
export function parseTimestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(':').map(parseFloat);
  let seconds = 0;
  if (parts.length === 3) {
    seconds += parts[0] * 3600;
    seconds += parts[1] * 60;
    seconds += parts[2];
  } else if (parts.length === 2) {
    seconds += parts[0] * 60;
    seconds += parts[1];
  }
  return seconds;
}

export function generateSRTContent(lines: SRTLine[]): string {
  return lines.map((line, index) => {
    return `${index + 1}\n${formatSRTTimestamp(line.startTime)} --> ${formatSRTTimestamp(line.endTime)}\n${line.text}\n`;
  }).join('\n');
}

export function downloadSRT(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}