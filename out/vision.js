"use strict";
/**
 * Shared vision-capability helpers for SimpleSignal.
 *
 * Centralizes three things that were previously scattered / broken:
 *  1. Detecting whether a model id supports image input (covers Ollama, Lemonade,
 *     LM Studio, OpenAI, Anthropic, Gemini, OpenRouter-style ids).
 *  2. Detecting vision support from server-provided metadata
 *     (labels, capabilities, modalities, architecture, features, ...).
 *  3. Converting VS Code `LanguageModelDataPart` image parts to OpenAI
 *     `image_url` content parts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectVisionFromId = detectVisionFromId;
exports.detectVisionFromMetadata = detectVisionFromMetadata;
exports.detectVisionSupport = detectVisionSupport;
exports.isAnyDataPart = isAnyDataPart;
exports.isImageDataPart = isImageDataPart;
exports.dataPartToDataUrl = dataPartToDataUrl;
exports.toOpenAIImagePart = toOpenAIImagePart;
/** Regexes matching model ids known (or strongly suspected) to accept image input. */
const VISION_ID_PATTERNS = [
    /vision/i,
    /visual/i,
    /multimodal/i,
    /-vl\b/i,
    /\bvl-/i,
    /vl\d/i,
    /[\W_]vl[\W_]/i,
    /vl$/i,
    /llava/i,
    /bakllava/i,
    /moondream/i,
    /minicpm/i,
    /internvl/i,
    /cogvlm/i,
    /pixtral/i,
    /qwen[\W_]?vl/i,
    /qwen[\W_]?2(\.5)?[\W_]?vl/i,
    /qwen[\W_]?3[\W_]?vl/i,
    /qvq/i,
    /phi[\W_]?[34][\W_]?(vision|multimodal)/i,
    /llama[\W_]?3\.2[\W_]?\d+b[\W_]?vision/i,
    /llama[\W_]?4[\W_]?(maverick|scout)/i,
    /gemma[\W_]?3/i,
    /gemma[\W_]?4/i,
    /gemma/i,
    /mistral[\W_]?small[\W_]?3/i,
    /mistral[\W_]?(medium[\W_]?3|large[\W_]?2|large[\W_]?24)/i,
    /gpt[\W_]?4o/i,
    /gpt[\W_]?4[\W_]?(turbo|vision)/i,
    /\bgpt[\W_]?5/i,
    /\bo[134]\b/i,
    /claude/i,
    /sonnet/i,
    /opus/i,
    /haiku/i,
    /gemini/i,
    /4o/i,
    /coyote/i,
    /snowfox/i,
    /paligemma/i,
    /idefics/i,
    /instructblip/i,
    /blip/i,
    /deepseek[\W_]?vl/i,
    /deepseek[\W_]?v[34]/i,
    /deepseek[\W_]?flash/i,
    /janus/i,
    /kimi[\W_]?vl/i,
    /kimi[\W_]?k[23]/i,
    /kimi/i,
    /glm[\W_]?4(\.\d)?v/i,
    /glm[\W_]?5/i,
    /\bglm\b/i,
    /qwen[\W_]?3/i,
    /qwen[\W_]?image/i,
    /qwen[\W_]?omni/i,
    /minimax[\W_]?m3/i,
    /\bm3\b/i,
    /muse[\W_]?spark/i,
    /muse[\W_]?image/i,
    /grok[\W_]?4/i,
    /gpt[\W_]?5/i,
    /chatgpt/i,
    /copilot[\W_]?chat/i,
    /ox[\W_]?alpha/i,
    /florence/i,
    /mmproj/i,
    /\bclip\b/i,
    /siglip/i,
    /wan[\W_]?2.*image/i,
    /image[\W_]?3/i,
    /mimo/i,
    /ovis/i,
    /flux/i,
    /\bsd[\W_]?turbo/i,
    /qwen[\W_]?(max|plus|turbo|flash)/i,
    /qwq/i,
    /z[\W_]?image/i,
];
/**
 * Returns true when a model id looks like a vision / image-input model.
 */
function detectVisionFromId(id) {
    const normalized = (id || '').trim();
    if (!normalized) {
        return false;
    }
    // Explicitly non-visual: audio-only, embeddings, rerankers, pure-text.
    if (/audio|tts|asr|transcribe|livetranslate|realtime|embed|rerank|tokenizer/i.test(normalized) &&
        !/omni|multimodal/i.test(normalized)) {
        return false;
    }
    return VISION_ID_PATTERNS.some((re) => re.test(normalized));
}
function strIncludesVision(value) {
    return /vision|image|multimodal/i.test(String(value ?? ''));
}
/**
 * Returns true when server-provided model metadata advertises image input.
 * Handles OpenAI-style (`modalities`), OpenRouter-style (`architecture`),
 * Ollama-style (`capabilities`), Lemonade-style (`labels`) and generic
 * `features` / `input_modalities` fields.
 */
function detectVisionFromMetadata(m) {
    if (!m || typeof m !== 'object') {
        return false;
    }
    const labels = m.labels || m.tags || [];
    if (Array.isArray(labels) && labels.some((l) => strIncludesVision(l))) {
        return true;
    }
    for (const key of [
        'capabilities',
        'features',
        'modalities',
        'input_modalities',
        'supported_modalities',
        'supported_modality',
        'inputModalities',
    ]) {
        const v = m[key];
        if (Array.isArray(v) && v.some((x) => strIncludesVision(x))) {
            return true;
        }
        if (typeof v === 'string' && strIncludesVision(v)) {
            return true;
        }
    }
    const arch = m.architecture || m.model_architecture || undefined;
    if (arch) {
        if (typeof arch === 'string' && strIncludesVision(arch)) {
            return true;
        }
        if (typeof arch === 'object') {
            for (const key of ['modalities', 'input_modalities', 'modality']) {
                const v = arch[key];
                if (Array.isArray(v) && v.some((x) => strIncludesVision(x))) {
                    return true;
                }
                if (typeof v === 'string' && strIncludesVision(v)) {
                    return true;
                }
            }
        }
    }
    if (typeof m.type === 'string' && /multimodal|vision/i.test(m.type)) {
        return true;
    }
    return false;
}
/**
 * Combined vision detection for a raw server model entry (object or plain id string).
 */
function detectVisionSupport(m) {
    const id = typeof m === 'string' ? m : m?.id || m?.name || m?.model || m?.checkpoint || '';
    return detectVisionFromMetadata(m) || detectVisionFromId(id);
}
/** Duck-type check for a VS Code LanguageModelDataPart (avoids instanceof pitfalls). */
function isAnyDataPart(part) {
    return (!!part &&
        typeof part === 'object' &&
        typeof part.mimeType === 'string' &&
        part.data instanceof Uint8Array);
}
/** True when the part is a LanguageModelDataPart holding image bytes. */
function isImageDataPart(part) {
    return (isAnyDataPart(part) &&
        part.mimeType.toLowerCase().startsWith('image/'));
}
/** Encodes a data part as a `data:` URL suitable for OpenAI `image_url`. */
function dataPartToDataUrl(part) {
    return `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`;
}
/** Builds an OpenAI chat content part referencing an image data URL. */
function toOpenAIImagePart(dataUrl) {
    return { type: 'image_url', image_url: { url: dataUrl } };
}
//# sourceMappingURL=vision.js.map