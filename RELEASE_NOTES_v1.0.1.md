# SimpleSignal v1.0.1 ⚡

Universal AI Model Provider for VS Code Chat with Live Telemetry, Model Speedometer, Hardware Diagnostics, Interactive Provider Dropdowns, Full Signal Endpoint Management Suite & Native SimpleRAG Integration.

---

## 🚀 What's New in v1.0.1

### ⚙️ 1. Complete Signal Endpoint Management Suite & Options... Dropdown
- **Options... Dropdown Menu**: Compact, sleek dropdown menu on every Endpoint Card and Sidebar Tree item to eliminate clutter while providing full management capability.
- **API Key Manager**: Set, edit, mask (`••••••••sk-1234`), and clear API keys per endpoint.
- **Base URL Editor**: Seamlessly edit host, port, or path for any endpoint directly from the UI.
- **Status Toggle**: One-click enable/disable toggle for any provider without losing configurations.
- **Ping & Latency Tester**: Measures live roundtrip ping and server response latency in milliseconds.
- **Custom Model Registration**: Register any custom model IDs with custom context length and output token bounds.
- **Protocol Switcher**: Easily toggle endpoints between `openai`, `lemonade`, `ollama`, `anthropic`, or `gemini` protocols.
- **Config Export**: Instant 1-click JSON configuration export to clipboard.

### 📂 2. Interactive Provider Dropdowns & Accordions
- **Provider Filter Dropdown**: Instantly filter across 250+ models by selecting a specific provider (*Lemonade*, *DashScope Qwen*, *Ollama*, *SimpleRAG*, *DeepSeek*) or viewing all providers at once.
- **Collapsible Provider Accordions**: Provider cards in the Visual Hub now feature expandable dropdown accordions with animated chevrons and model count badges.
- **Batch Expand/Collapse**: One-click **Expand All** and **Collapse All** controls for effortless navigation.
- **Grouped Sidebar Models**: In the VS Code Sidebar TreeView, models and endpoint options are neatly organized under collapsible sub-folders.
- **Benchmark Provider Filtering**: Speed benchmark setup now includes a dedicated provider selector and `<optgroup>` hierarchy.

### 🧠 3. Theme-Adaptive UI & Clean Thought Stream Framing
- **100% Theme Adaptive Icons**: Vector logos and icons adapt dynamically to standard VS Code theme tokens across Dark, Light, and High Contrast themes.
- **Zero Horizontal Scrolling**: Thought process is cleanly framed with subtle horizontal dividers and soft italic text, with full natural word-wrapping.

### 📚 4. Native SimpleRAG Integration (Port 11211)
- **Automatic Server Auto-Probe**: Natively probes and registers SimpleRAG's OpenAI-compatible server on `http://127.0.0.1:11211/v1`.
- **Automatic Key Detection**: Grabs server keys automatically from runtime settings (`simple_rag_server_settings.json`), environment variables, or fallback server credentials.
- **Populated RAG Models**: Direct integration with `simple-rag-rag` (RAG Context Retrieval), `simple-rag-chat` (Direct Chat), `simple-rag-embedder`, and `simple-rag-reranker`.

### ⚡ 5. Live Model Telemetry & Speedometer HUD
- **Real-Time Speedometer**: Real-time Tokens Per Second (TPS), Peak TPS, and Output Token counters for any model used in VS Code Chat.
- **TTFT & Latency Gauge**: Time-To-First-Token latency rating and total turnaround duration timer.
- **Split Prompt/Stream Inspector**: Side-by-side view comparing prompt sent vs live streaming response.
- **Status Bar Integration**: Live animated speedometer in the VS Code status bar during chat generations.

### 🐧 6. Cross-Platform Linux & Windows System Diagnostics
- **GPU VRAM Monitoring**: Supports NVIDIA (`nvidia-smi`) and AMD ROCm (`rocm-smi`) on Linux, alongside Windows WMI and performance counters.
- **Process Cleanup**: Cross-platform memory profiling and safe process termination.

---

## 📦 Installation
Download the attached `simplesignal-provider-1.0.1.vsix` and install it in VS Code:
```bash
code --install-extension simplesignal-provider-1.0.1.vsix
```
Or open VS Code, press **`Ctrl + Shift + P`** $\rightarrow$ **`Extensions: Install from VSIX...`**, and select the file!
