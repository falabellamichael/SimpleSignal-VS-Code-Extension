"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelTelemetryTracker = void 0;
const vscode = __importStar(require("vscode"));
class ModelTelemetryTracker {
    static activeStats = null;
    static lastStats = null;
    static history = [];
    static firstTokenTimeMap = new Map();
    static _onTelemetryEvent = new vscode.EventEmitter();
    static onTelemetryEvent = this._onTelemetryEvent.event;
    static startMessage(params) {
        const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const now = Date.now();
        const stats = {
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
    static recordFirstToken(id) {
        if (!this.activeStats || this.activeStats.id !== id)
            return;
        if (this.activeStats.ttftMs === 0) {
            const now = Date.now();
            this.activeStats.ttftMs = Math.max(1, now - this.activeStats.startTime);
            this.firstTokenTimeMap.set(id, now);
        }
    }
    static updateChunk(id, chunk, isThinking = false) {
        if (!this.activeStats || this.activeStats.id !== id)
            return;
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
        }
        else {
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
    static completeMessage(id, extra) {
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
    static failMessage(id, errorMessage) {
        if (!this.activeStats || this.activeStats.id !== id)
            return;
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
    static getLastStats() {
        return this.lastStats ? { ...this.lastStats } : null;
    }
    static getActiveStats() {
        return this.activeStats ? { ...this.activeStats } : null;
    }
    static getHistory() {
        return [...this.history];
    }
    static clearHistory() {
        this.history = [];
        this.lastStats = null;
        this.activeStats = null;
    }
}
exports.ModelTelemetryTracker = ModelTelemetryTracker;
//# sourceMappingURL=telemetryTracker.js.map