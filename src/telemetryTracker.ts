import * as vscode from 'vscode';
import { LiveModelStats } from './types';

export interface TelemetryEvent {
  type: 'start' | 'chunk' | 'complete' | 'error';
  stats: LiveModelStats;
  chunk?: string;
}

export class ModelTelemetryTracker {
  private static activeStats: LiveModelStats | null = null;
  private static lastStats: LiveModelStats | null = null;
  private static history: LiveModelStats[] = [];
  private static firstTokenTimeMap: Map<string, number> = new Map();
  private static _onTelemetryEvent = new vscode.EventEmitter<TelemetryEvent>();

  public static readonly onTelemetryEvent = this._onTelemetryEvent.event;

  public static startMessage(params: {
    modelId: string;
    modelName?: string;
    endpointName: string;
    protocol?: string;
    source?: 'vscode-chat' | 'benchmark' | 'inline-edit' | 'tool-call';
    promptPreview?: string;
    promptTokens?: number;
  }): LiveModelStats {
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();

    const stats: LiveModelStats = {
      id,
      modelId: params.modelId,
      modelName: params.modelName || params.modelId,
      endpointName: params.endpointName,
      protocol: params.protocol || 'openai',
      source: params.source || 'vscode-chat',
      status: 'streaming',
      startTime: now,
      timestamp: now,
      promptPreview: params.promptPreview || '',
      outputPreview: '',
      promptTokens: params.promptTokens || Math.max(1, Math.ceil((params.promptPreview?.length || 0) / 4)),
      tokensGenerated: 0,
      ttftMs: 0,
      generationDurationMs: 0,
      totalDurationMs: 0,
      tokensPerSec: 0,
      peakTPS: 0,
      isThinking: false,
      thinkingTokens: 0,
    };

    this.activeStats = stats;
    this._onTelemetryEvent.fire({ type: 'start', stats: { ...stats } });
    return stats;
  }

  public static recordFirstToken(id: string): void {
    if (!this.activeStats || this.activeStats.id !== id) return;
    if (this.activeStats.ttftMs === 0) {
      const now = Date.now();
      this.activeStats.ttftMs = Math.max(1, now - this.activeStats.startTime);
      this.firstTokenTimeMap.set(id, now);
    }
  }

  public static updateChunk(id: string, chunk: string, isThinking: boolean = false): void {
    if (!this.activeStats || this.activeStats.id !== id) return;

    const stats = this.activeStats;
    const now = Date.now();

    if (stats.ttftMs === 0) {
      stats.ttftMs = Math.max(1, now - stats.startTime);
      this.firstTokenTimeMap.set(id, now);
    }

    const firstTokTime = this.firstTokenTimeMap.get(id) || stats.startTime;
    const genDurationSec = Math.max(0.001, (now - firstTokTime) / 1000);

    // Approximate token count: 1 token ~= 3.6 chars
    const approxNewTokens = Math.max(1, Math.round(chunk.length / 3.6));

    if (isThinking) {
      stats.isThinking = true;
      stats.thinkingTokens = (stats.thinkingTokens || 0) + approxNewTokens;
    } else {
      stats.tokensGenerated += approxNewTokens;
      // Keep output preview up to reasonable length
      if (stats.outputPreview.length < 5000) {
        stats.outputPreview += chunk;
      }
    }

    stats.generationDurationMs = Math.max(1, now - firstTokTime);
    stats.totalDurationMs = Math.max(1, now - stats.startTime);

    const totalToks = stats.tokensGenerated + (stats.thinkingTokens || 0);
    const currentTPS = Number((totalToks / genDurationSec).toFixed(1));
    stats.tokensPerSec = currentTPS;
    if (currentTPS > stats.peakTPS) {
      stats.peakTPS = currentTPS;
    }

    this._onTelemetryEvent.fire({ type: 'chunk', stats: { ...stats }, chunk });
  }

  public static completeMessage(id: string, extra?: Partial<LiveModelStats>): LiveModelStats | undefined {
    if (!this.activeStats || this.activeStats.id !== id) {
      if (this.lastStats && this.lastStats.id === id) {
        return this.lastStats;
      }
      return undefined;
    }

    const now = Date.now();
    const stats = this.activeStats;
    stats.status = 'completed';
    stats.endTime = now;
    stats.totalDurationMs = Math.max(1, now - stats.startTime);

    const firstTokTime = this.firstTokenTimeMap.get(id) || stats.startTime;
    stats.generationDurationMs = Math.max(1, now - firstTokTime);

    if (stats.ttftMs === 0) {
      stats.ttftMs = Math.max(1, now - stats.startTime);
    }

    const totalToks = stats.tokensGenerated + (stats.thinkingTokens || 0);
    const genSec = Math.max(0.001, stats.generationDurationMs / 1000);
    stats.tokensPerSec = Number((totalToks / genSec).toFixed(1));

    if (extra) {
      Object.assign(stats, extra);
    }

    this.firstTokenTimeMap.delete(id);
    this.lastStats = { ...stats };
    this.activeStats = null;

    // Add to history ring buffer (max 50)
    this.history.unshift(this.lastStats);
    if (this.history.length > 50) {
      this.history.pop();
    }

    this._onTelemetryEvent.fire({ type: 'complete', stats: this.lastStats });
    return this.lastStats;
  }

  public static failMessage(id: string, errorMessage: string): void {
    if (!this.activeStats || this.activeStats.id !== id) return;

    const now = Date.now();
    const stats = this.activeStats;
    stats.status = 'error';
    stats.endTime = now;
    stats.errorMessage = errorMessage;
    stats.totalDurationMs = Math.max(1, now - stats.startTime);

    this.firstTokenTimeMap.delete(id);
    this.lastStats = { ...stats };
    this.activeStats = null;

    this.history.unshift(this.lastStats);
    if (this.history.length > 50) {
      this.history.pop();
    }

    this._onTelemetryEvent.fire({ type: 'error', stats: this.lastStats });
  }

  public static getLastStats(): LiveModelStats | null {
    return this.lastStats ? { ...this.lastStats } : null;
  }

  public static getActiveStats(): LiveModelStats | null {
    return this.activeStats ? { ...this.activeStats } : null;
  }

  public static getHistory(): LiveModelStats[] {
    return [...this.history];
  }

  public static clearHistory(): void {
    this.history = [];
    this.lastStats = null;
    this.activeStats = null;
  }
}
