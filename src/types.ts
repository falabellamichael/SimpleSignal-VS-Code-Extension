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

