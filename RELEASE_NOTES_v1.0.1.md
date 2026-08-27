# SimpleSignal v1.0.1 ⚡

Universal AI Model Provider for VS Code Chat with Live Telemetry, Model Speedometer, Hardware Diagnostics, Interactive Provider Dropdowns & Native SimpleRAG Integration.

---

## 🚀 What's New in v1.0.1

### 📂 1. Interactive Provider Dropdowns & Accordions
- **Provider Filter Dropdown**: Instantly filter across 250+ models by selecting a specific provider (*Lemonade*, *DashScope Qwen*, *Ollama*, *SimpleRAG*, *DeepSeek*) or viewing all providers at once.
- **Collapsible Provider Accordions**: Provider cards in the Visual Hub now feature expandable dropdown accordions with animated chevrons and model count badges.
- **Batch Expand/Collapse**: One-click **Expand All** and **Collapse All** controls for effortless navigation.
- **Grouped Sidebar Models**: In the VS Code Sidebar TreeView, models are now neatly organized under collapsible provider dropdown nodes rather than an overwhelming flat list.
- **Benchmark Provider Filtering**: Speed benchmark setup now includes a dedicated provider selector and `<optgroup>` hierarchy.

### 📚 2. Native SimpleRAG Integration (Port 11211)
- **Automatic Server Auto-Probe**: Natively probes and registers SimpleRAG's OpenAI-compatible server on `http://127.0.0.1:11211/v1`.
- **Automatic Key Detection**: Grabs server keys automatically from runtime settings (`simple_rag_server_settings.json`), environment variables, or fallback server credentials.
- **Populated RAG Models**: Direct integration with `simple-rag-rag` (RAG Context Retrieval), `simple-rag-chat` (Direct Chat), `simple-rag-embedder`, and `simple-rag-reranker`.

### ⚡ 3. Live Model Telemetry & Speedometer HUD
- **Real-Time Speedometer**: Real-time Tokens Per Second (TPS), Peak TPS, and Output Token counters for any model used in VS Code Chat.
- **TTFT & Latency Gauge**: Time-To-First-Token latency rating and total turnaround duration timer.
- **Split Prompt/Stream Inspector**: Side-by-side view comparing prompt sent vs live streaming response.
- **Status Bar Integration**: Live animated speedometer in the VS Code status bar during chat generations.

### 🐧 4. Cross-Platform Linux & Windows System Diagnostics
- **GPU VRAM Monitoring**: Supports NVIDIA (`nvidia-smi`) and AMD ROCm (`rocm-smi`) on Linux, alongside Windows WMI and performance counters.
- **Process Cleanup**: Cross-platform memory profiling and safe process termination.

### 🔑 5. Automatic Multi-Source API Key Resolution
- Automatically grabs and rotates API keys from `process.env` (`DASHSCOPE_API_KEY`, `QWEN_API_KEY`, `OPENAI_API_KEY`, `LEMONADE_API_KEY`, `LM_STUDIO_API_KEY`, `DEEPSEEK_API_KEY`, `SIMPLERAG_API_KEY`), eliminating `401 Unauthorized` errors.

---

## 📦 Installation
Download the attached `simplesignal-provider-1.0.1.vsix` and install it in VS Code:
```bash
code --install-extension simplesignal-provider-1.0.1.vsix
```
Or open VS Code, press **`Ctrl + Shift + P`** $\rightarrow$ **`Extensions: Install from VSIX...`**, and select the file!
