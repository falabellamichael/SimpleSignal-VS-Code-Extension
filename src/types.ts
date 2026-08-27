export type EndpointProtocol = 'openai' | 'ollama' | 'lemonade' | 'anthropic' | 'gemini';

export interface ModelConfig {
  id: string;
  name?: string;
  contextLength?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  enabled?: boolean;
  endpointName?: string;
}

export interface EndpointConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  protocol?: EndpointProtocol;
  enabled?: boolean;
  customHeaders?: Record<string, string>;
  models?: ModelConfig[];
}

export interface SimpleSignalConfig {
  autoScanLocalServers: boolean;
  autoFetchOnStartup: boolean;
  endpoints: EndpointConfig[];
}

export interface ProcessMemoryInfo {
  pid: number;
  name: string;
  ramMB: number;
  vramMB?: number;
  isAIModel?: boolean;
  modelDetails?: string;
  path?: string;
  commandLine?: string;
}

export interface RAMDiagnostics {
  totalGB: number;
  usedGB: number;
  freeGB: number;
  usedPercent: number;
  processes: ProcessMemoryInfo[];
  aiProcesses: ProcessMemoryInfo[];
}

export interface VRAMDiagnostics {
  gpuName: string;
  usedVRAM_MB: number;
  processes: ProcessMemoryInfo[];
  aiProcesses: ProcessMemoryInfo[];
}

export interface LoadedAIModel {
  source: 'ollama' | 'llamacpp' | 'python' | 'lmstudio' | 'vllm' | 'process';
  name: string;
  pid?: number;
  vramMB?: number;
  ramMB?: number;
  sizeFormatted?: string;
  details?: string;
  expiresAt?: string;
}

export interface BenchmarkPreset {
  id: string;
  name: string;
  description: string;
  prompt: string;
  maxTokens: number;
}

export interface BenchmarkResult {
  modelId: string;
  endpointName: string;
  protocol: string;
  presetName: string;
  prompt: string;
  outputPreview: string;
  tokensGenerated: number;
  promptTokens?: number;
  ttftMs: number;
  generationDurationMs: number;
  totalDurationMs: number;
  tokensPerSec: number;
  status: 'success' | 'error';
  errorMessage?: string;
  timestamp: number;
}

export interface LiveModelStats {
  id: string;
  modelId: string;
  modelName?: string;
  endpointName: string;
  protocol: string;
  source: 'vscode-chat' | 'benchmark' | 'inline-edit' | 'tool-call';
  status: 'streaming' | 'completed' | 'error' | 'aborted' | 'idle';
  startTime: number;
  endTime?: number;
  timestamp: number;
  promptPreview: string;
  outputPreview: string;
  promptTokens: number;
  tokensGenerated: number;
  ttftMs: number;
  generationDurationMs: number;
  totalDurationMs: number;
  tokensPerSec: number;
  peakTPS: number;
  isThinking?: boolean;
  thinkingTokens?: number;
  errorMessage?: string;
}

export interface TelemetrySnapshot {
  timestamp: number;
  ram: RAMDiagnostics;
  vram: VRAMDiagnostics;
  loadedModels: LoadedAIModel[];
  recentBenchmarks: BenchmarkResult[];
  lastMessage?: LiveModelStats | null;
  activeMessage?: LiveModelStats | null;
  messageHistory?: LiveModelStats[];
}
