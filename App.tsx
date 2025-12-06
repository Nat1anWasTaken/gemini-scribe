import React, { useState, useRef, useEffect } from 'react';
import { Upload, FileAudio, FileText, Download, AlertCircle, Loader2, Terminal } from 'lucide-react';
import { processAudioFile, blobToBase64 } from './utils/audioUtils';
import { transcribeChunk } from './services/geminiService';
import { parseTimestampToSeconds, generateSRTContent, downloadSRT } from './utils/srtUtils';
import { AudioChunk, ProcessingStatus, SRTLine } from './types';
import { ProgressBar } from './components/ProgressBar';
import { StepCard } from './components/StepCard';

const App: React.FC = () => {
  // State
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState<string>("");
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [chunks, setChunks] = useState<AudioChunk[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState<number>(0);
  const [srtLines, setSrtLines] = useState<SRTLine[]>([]);
  const [completed, setCompleted] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [streamLog, setStreamLog] = useState<string>("");
  const [thinkingLog, setThinkingLog] = useState<string>("");
  const [modelId, setModelId] = useState<string>("gemini-3-pro-preview");
  const [contextSummary, setContextSummary] = useState<string>("");
  const [failedChunkIndex, setFailedChunkIndex] = useState<number | null>(null);
  
  // Log container refs for auto-scrolling
  const logContainerRef = useRef<HTMLDivElement>(null);
  const thinkingContainerRef = useRef<HTMLDivElement>(null);

  // Refs for processing loop
  const contextSummaryRef = useRef<string>("");
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [streamLog]);

  useEffect(() => {
    if (thinkingContainerRef.current) {
      thinkingContainerRef.current.scrollTop = thinkingContainerRef.current.scrollHeight;
    }
  }, [thinkingLog]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setError(null);
      resetState();
    }
  };

  const resetState = () => {
    setStatus(ProcessingStatus.IDLE);
    setChunks([]);
    setSrtLines([]);
    setCompleted(false);
    setCurrentChunkIndex(0);
    contextSummaryRef.current = "";
    setStatusMessage("");
    setStreamLog("");
    setThinkingLog("");
    setContextSummary("");
    setFailedChunkIndex(null);
  };

  const startProcessing = async () => {
    if (!file || !description) return;

    // Fresh run state
    setError(null);
    setCompleted(false);
    setSrtLines([]);
    setChunks([]);
    setCurrentChunkIndex(0);
    setStatusMessage("");
    setStreamLog("");
    setThinkingLog("");
    setContextSummary("");
    contextSummaryRef.current = "";
    setFailedChunkIndex(null);
    setStatus(ProcessingStatus.DECODING);
    
    try {
      // Step 1: Decode and Split
      const generatedChunks = await processAudioFile(file, (msg) => setStatusMessage(msg));
      setChunks(generatedChunks);
      
      setStatus(ProcessingStatus.TRANSCRIBING);
      processChunks(generatedChunks);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to process audio file.");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  const processChunks = async (audioChunks: AudioChunk[], startIndex: number = 0) => {
    abortControllerRef.current = new AbortController();
    let currentSrtId = 1;

    // If resuming, preserve existing SRT ids by starting after current length
    if (startIndex > 0) {
      currentSrtId = srtLines.length + 1;
    }

    for (let i = startIndex; i < audioChunks.length; i++) {
      if (abortControllerRef.current?.signal.aborted) break;

      const chunk = audioChunks[i];
      setCurrentChunkIndex(i);
      setStatusMessage(`Transcribing part ${i + 1} of ${audioChunks.length}...`);
      setStreamLog(prev => prev + `\n--- Processing Chunk ${i + 1}/${audioChunks.length} ---\n`);

      try {
        const base64 = await blobToBase64(chunk.blob);
        
        // Retry logic for API calls
        let retries = 3;
        let result = null;
        
        // Handler to accumulate streaming logs
        const onChunkLog = (text: string) => {
          setStreamLog(prev => prev + text);
        };

        const onThinkingLog = (text: string) => {
          setThinkingLog(prev => prev + text);
        };

        while (retries > 0 && !result) {
          try {
            result = await transcribeChunk(base64, description, contextSummaryRef.current, modelId, onChunkLog, onThinkingLog);
          } catch (e) {
            console.warn(`Retry ${4 - retries} failed for chunk ${i}`);
            setStreamLog(prev => prev + `\n[Error: Retry ${4 - retries} failed...]\n`);
            retries--;
            if (retries === 0) throw e;
            await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
          }
        }

        if (result) {
          setStreamLog(prev => prev + `\n\n[Chunk ${i + 1} Completed]\n`);
          // Update context for next chunk
          contextSummaryRef.current = result.summary;
          setContextSummary(result.summary);
          setFailedChunkIndex(null);

          // Process timestamps
          // chunk.startTime is the absolute time where this chunk begins (0s, 600s, 1200s...)
          // The buffer (10s) is included at the END of the audio sent to Gemini.
          // We want to discard lines that start *after* the non-buffered duration (600s),
          // unless it's the very last chunk.
          
          const chunkDurationLimit = 300; // 5 minutes

          const validLines = result.lines.map(line => {
             const startRelative = parseTimestampToSeconds(line.start);
             const endRelative = parseTimestampToSeconds(line.end);
             
             return {
               id: currentSrtId++,
               startTime: chunk.startTime + startRelative,
               endTime: chunk.startTime + endRelative,
               text: line.text
             };
          }).filter(line => {
             // Filter logic:
             // A line is valid if its relative start time is within the main 5-minute block.
             // If it starts in the 10s buffer zone (e.g. at 305s), it belongs to the *next* chunk.
             // Exception: The very last chunk keeps everything.
             const relativeStart = line.startTime - chunk.startTime;
             const isLastChunk = i === audioChunks.length - 1;
             
             if (isLastChunk) return true;
             return relativeStart < chunkDurationLimit;
          });

          setSrtLines(prev => [...prev, ...validLines]);
        }

      } catch (err: any) {
        setError(`Error processing chunk ${i + 1}: ${err.message}`);
        setFailedChunkIndex(i);
        setStatus(ProcessingStatus.ERROR);
        return; 
      }
    }

    setCompleted(true);
    setStatus(ProcessingStatus.COMPLETED);
    setStatusMessage("Transcription complete!");
  };

  const resumeFromCurrent = () => {
    if (!chunks.length) return;
    setFailedChunkIndex(null);
    setError(null);
    setStatus(ProcessingStatus.TRANSCRIBING);
    setStatusMessage(`Resuming at part ${currentChunkIndex + 1} of ${chunks.length}...`);
    processChunks(chunks, currentChunkIndex);
  };

  const handleSummaryEdit = (value: string) => {
    setContextSummary(value);
    contextSummaryRef.current = value;
  };

  const handleEditLine = (id: number, newText: string) => {
    setSrtLines(prev => prev.map(line => line.id === id ? { ...line, text: newText } : line));
  };

  const handleDownload = () => {
    const srtContent = generateSRTContent(srtLines);
    downloadSRT(srtContent, `${file?.name.split('.')[0] || 'transcript'}.srt`);
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="text-center">
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight sm:text-5xl mb-4">
            Gemini Scribe
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Long-form audio transcription using Gemini 3 Pro. Auto-splits audio, maintains context, and generates SRT subtitles.
          </p>
        </div>

        {/* Steps Container */}
        <div className="space-y-6">

          {/* Step 1: Upload */}
          <StepCard 
            stepNumber={1}
            title="Upload Audio" 
            description="Select an audio file (MP3, WAV, M4A). Large files are supported."
            isActive={status === ProcessingStatus.IDLE}
            isCompleted={!!file && status !== ProcessingStatus.IDLE}
          >
            <div className="mt-4">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-300 border-dashed rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  {file ? (
                     <div className="flex items-center gap-2 text-indigo-600">
                        <FileAudio className="w-8 h-8" />
                        <span className="font-semibold text-lg">{file.name}</span>
                        <span className="text-xs text-slate-500">({(file.size / (1024*1024)).toFixed(2)} MB)</span>
                     </div>
                  ) : (
                    <>
                        <Upload className="w-8 h-8 mb-3 text-slate-400" />
                        <p className="mb-2 text-sm text-slate-500"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                    </>
                  )}
                </div>
                <input type="file" className="hidden" accept="audio/*" onChange={handleFileChange} disabled={status !== ProcessingStatus.IDLE} />
              </label>
            </div>
          </StepCard>

          {/* Step 2: Configuration */}
          <StepCard 
            stepNumber={2}
            title="Transcription Instructions" 
            description="Tell the AI how to transcribe (e.g., 'Japanese to Traditional Chinese', 'Verbatim English', 'Add speaker labels')."
            isActive={!!file && status === ProcessingStatus.IDLE}
            isCompleted={status !== ProcessingStatus.IDLE}
          >
            <div className="mt-4 space-y-4">
              <div className="space-y-1">
                <label className="block text-sm font-semibold text-slate-700">Model ID</label>
                <input
                  type="text"
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value)}
                  placeholder="gemini-3-pro-preview"
                  className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                  disabled={status !== ProcessingStatus.IDLE}
                />
              </div>

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="E.g., Transcribe Japanese audio into Traditional Chinese subtitles. Keep lines short and concise."
                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[120px] bg-white"
                disabled={status !== ProcessingStatus.IDLE}
              />
              
              <div className="pt-2 flex justify-end">
                <button
                  onClick={startProcessing}
                  disabled={!file || !description || status !== ProcessingStatus.IDLE}
                  className={`
                    px-6 py-2 rounded-lg font-semibold text-white shadow-sm flex items-center gap-2
                    ${(!file || !description) ? 'bg-slate-300 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'}
                  `}
                >
                  {status === ProcessingStatus.IDLE ? 'Start Transcription' : 'Processing...'}
                </button>
              </div>
            </div>
          </StepCard>

          {/* Step 3: Processing */}
          {(status === ProcessingStatus.DECODING || status === ProcessingStatus.TRANSCRIBING || status === ProcessingStatus.COMPLETED || status === ProcessingStatus.ERROR) && (
            <StepCard 
                stepNumber={3}
                title="Processing" 
                description="Splitting audio and generating transcripts with AI."
                isActive={status !== ProcessingStatus.COMPLETED && status !== ProcessingStatus.ERROR}
                isCompleted={status === ProcessingStatus.COMPLETED}
            >
                <div className="mt-4 space-y-4">
                    {/* Overall Progress */}
                    {status === ProcessingStatus.ERROR ? (
                        <div className="p-4 bg-red-50 text-red-700 rounded-lg flex items-start gap-3 border border-red-200">
                            <AlertCircle className="w-5 h-5 mt-0.5" />
                            <div className="flex-1 space-y-3">
                              <div>{error}</div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={resumeFromCurrent}
                                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 font-semibold shadow-sm"
                                  disabled={!chunks.length}
                                >
                                  Retry chunk {failedChunkIndex !== null ? failedChunkIndex + 1 : currentChunkIndex + 1}
                                </button>
                                <button
                                  onClick={startProcessing}
                                  className="px-4 py-2 bg-white text-indigo-700 border border-indigo-200 rounded-md hover:bg-indigo-50 font-semibold shadow-sm disabled:opacity-50"
                                  disabled={!file || !description}
                                >
                                  Restart from beginning
                                </button>
                                <button
                                  onClick={() => abortControllerRef.current?.abort()}
                                  className="px-4 py-2 bg-slate-200 text-slate-800 rounded-md hover:bg-slate-300 font-semibold shadow-sm"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                             <div className="flex items-center gap-2 text-indigo-700 font-medium">
                                {status !== ProcessingStatus.COMPLETED && <Loader2 className="w-4 h-4 animate-spin" />}
                                <span>{statusMessage}</span>
                             </div>
                             
                             {status === ProcessingStatus.TRANSCRIBING && chunks.length > 0 && (
                                <ProgressBar 
                                    progress={((currentChunkIndex) / chunks.length) * 100} 
                                    label="Total Progress"
                                />
                             )}

                            {/* Live Stream Logs */}
                            <div className="mt-4">
                                <div className="flex items-center gap-2 mb-2 text-sm text-slate-600 font-semibold">
                                    <Terminal className="w-4 h-4" />
                                    <span>Model Reasoning</span>
                                </div>
                                <div
                                    ref={thinkingContainerRef}
                                    className="bg-slate-900 text-indigo-200 font-mono text-xs p-4 rounded-lg h-40 overflow-y-auto whitespace-pre-wrap shadow-inner border border-indigo-700"
                                >
                                    {thinkingLog || <span className="text-slate-500 italic">Waiting for reasoning stream...</span>}
                                </div>

                            <div className="flex items-center gap-2 mb-2 text-sm text-slate-600 font-semibold">
                                <Terminal className="w-4 h-4" />
                                <span>Live Model Output</span>
                            </div>
                            <div
                                    ref={logContainerRef}
                                    className="bg-slate-900 text-green-400 font-mono text-xs p-4 rounded-lg h-64 overflow-y-auto whitespace-pre-wrap shadow-inner border border-slate-700"
                                >
                                {streamLog || <span className="text-slate-500 italic">Waiting for model stream...</span>}
                                </div>
                             </div>

                            {/* Editable running summary */}
                            {(status === ProcessingStatus.TRANSCRIBING || status === ProcessingStatus.COMPLETED || contextSummary) && (
                              <div className="mt-6">
                                <div className="flex items-center gap-2 mb-2 text-sm text-slate-600 font-semibold">
                                  <Terminal className="w-4 h-4" />
                                  <span>Context Summary (used for next chunks)</span>
                                </div>
                                <textarea
                                  value={contextSummary}
                                  onChange={(e) => handleSummaryEdit(e.target.value)}
                                  placeholder="Live running summary that is passed to the model for context. Edit to correct or guide the next chunks."
                                  className="w-full border border-slate-300 rounded-md p-3 text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 min-h-[90px]"
                                />
                              </div>
                            )}

                            {/* Editable transcript so far */}
                            {srtLines.length > 0 && (
                              <div className="mt-6">
                                <div className="flex items-center gap-2 mb-2 text-sm text-slate-600 font-semibold">
                                    <Terminal className="w-4 h-4" />
                                    <span>Edit Transcript (live)</span>
                                </div>
                                <div className="bg-white border border-slate-200 rounded-lg p-3 max-h-72 overflow-y-auto space-y-3">
                                  {srtLines.map(line => (
                                    <div key={line.id} className="space-y-1">
                                      <div className="text-xs text-indigo-600 font-mono">
                                        {new Date(line.startTime * 1000).toISOString().substr(11, 12).replace('.', ',')} 
                                        {" --> "} 
                                        {new Date(line.endTime * 1000).toISOString().substr(11, 12).replace('.', ',')}
                                      </div>
                                      <textarea
                                        value={line.text}
                                        onChange={(e) => handleEditLine(line.id, e.target.value)}
                                        className="w-full border border-slate-300 rounded-md p-2 text-sm font-mono bg-slate-50 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                        rows={2}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                        </div>
                    )}
                </div>
            </StepCard>
          )}

          {/* Step 4: Results */}
          {completed && (
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900">Transcript Ready</h2>
                        <p className="text-slate-500">Generated {srtLines.length} subtitle lines.</p>
                    </div>
                    <button
                        onClick={handleDownload}
                        className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-md font-semibold transition-colors"
                    >
                        <Download className="w-5 h-5" />
                        Download .SRT
                    </button>
                </div>

                <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 max-h-96 overflow-y-auto font-mono text-sm">
                    {srtLines.map((line) => (
                        <div key={line.id} className="mb-4 last:mb-0">
                            <div className="text-indigo-500 text-xs mb-1">
                                {new Date(line.startTime * 1000).toISOString().substr(11, 12).replace('.', ',')} 
                                {" --> "} 
                                {new Date(line.endTime * 1000).toISOString().substr(11, 12).replace('.', ',')}
                            </div>
                            <div className="text-slate-800">{line.text}</div>
                        </div>
                    ))}
                </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

export default App;
