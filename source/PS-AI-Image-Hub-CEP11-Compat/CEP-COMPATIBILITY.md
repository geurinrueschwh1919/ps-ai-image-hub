# CEP compatibility matrix

## Primary target

| Item | Selected value | Photoshop 2024 / 25.0 status |
|---|---|---:|
| Photoshop host IDs | `PHSP` and `PHXS` | Supported; both Photoshop CEP host identifiers use the same version range |
| Host range | `[24.0,27.0)` | Includes 24.x, all 25.x, and 26.x |
| Required CEP runtime | `CSXS 11.0` | Supported by Photoshop 25.0 |
| Manifest schema version | `7.0` | Supported; CEP HTML manifests require 5.0+ and the 7.0 schema remains compatible |
| Extension type | `Panel` | Supported and dockable |
| Client bridge | Minimal `CSInterface` adapter / Adobe CEP `evalScript()` | Supported; replaceable by Adobe's full v11.0.0 library |
| Extension/user-data paths | `SystemPath.EXTENSION`, `SystemPath.USER_DATA`, `CSInterface.getSystemPath()` | Supported by CEP 11; locates Mock and transient Provider PNG files |
| Host scripting | Photoshop ExtendScript | Supported |
| Node.js | Disabled | Not required |
| Client networking | `XMLHttpRequest` boundary | Available; real providers must satisfy CORS |
| Per-user extension path | `%APPDATA%\Adobe\CEP\extensions` | Supported |
| Debug preference | `HKCU\Software\Adobe\CSXS.11\PlayerDebugMode=1` | Required only for unsigned development copies |

## Runtime selection rationale

Adobe's CEP 12 integration table lists Photoshop `25.12` as the first Photoshop build integrated with CEP 12. Photoshop 25.0 therefore remains on CEP 11. The manifest requires CSXS 11.0 to preserve the Photoshop 25.0 baseline; later CEP runtimes are expected to preserve backward-compatible CEP JavaScript APIs but still require host regression testing.

The Host range deliberately includes adjacent Photoshop 24.x and 26.x versions. Both `PHSP` and `PHXS` declare `[24.0,27.0)` so Photoshop can match either supported CEP host identifier. Photoshop 25.0 is the hard acceptance target. No feature may be declared compatible with adjacent versions until manually tested there.

## Client and host boundaries

| API / feature | Purpose | Compatibility / fallback |
|---|---|---|
| `CSInterface.evalScript()` | Invoke fixed functions in `host.jsx` | Calls are centralized in `PhotoshopBridge`; arguments are string-escaped and arbitrary method names are rejected. |
| `app.version` | Photoshop version detection | Returned as a string through the bridge. |
| `app.documents.length` | Open-document detection | Returns `false` if Photoshop reports no documents. |
| `app.activeDocument.name` | Active document name | Called only after checking `documents.length`. |
| `File`, binary `open/read/close` | Verify the local Mock PNG before Photoshop opens it | Long-standing ExtendScript APIs; checks file existence, `.png` extension, and the 8-byte PNG signature. |
| `app.open(File)` | Open the generated PNG as a temporary Photoshop document | Long-standing Photoshop ExtendScript DOM API and supported by Photoshop 25.0. |
| `ArtLayer.duplicate(targetDocument, ElementPlacement.PLACEATBEGINNING)` | Copy one image layer into the original active document | Long-standing Photoshop ExtendScript DOM API; avoids Action Manager and does not resize the target document. |
| `Document.close(SaveOptions.DONOTSAVECHANGES)` | Close the temporary PNG document | Long-standing Photoshop ExtendScript DOM API; the generated asset and target PSD are not saved or overwritten. |
| `importImage(filePath)` | Structured Phase 6 import boundary | Implemented through the DOM open → duplicate → close workflow; returns one layer name or a stable error code. |
| `localStorage` | Non-secret Provider configuration | Credentials are removed before serialization. Corrupt data falls back to an empty list. |
| `sessionStorage` | Default ephemeral secrets | Not persisted unless the user explicitly selects **记住 API Key**. |
| CEP `USER_DATA` JSON file | Optional remembered API Keys and local history | CEP 11 supports the required file I/O, but this is not OS-level encrypted storage; UI labels it as local plaintext-sensitive data. |
| `XMLHttpRequest` | JSON Provider calls and binary image downloads | Available in CEP 11 / CEF 88; CORS remains enforced. |
| `window.atob`, `window.btoa`, typed arrays | Base64 validation and binary conversion | Standard CEF 88 browser APIs; no Node Buffer dependency. |
| `window.cep.fs.makedir/stat/writeFile/deleteFile` | Write and clean transient generated PNGs | Adobe CEP filesystem API; writes use `cep.encoding.Base64`. |
| `SystemPath.USER_DATA` | Per-user transient image root | Adobe CSInterface API available in CEP 11; avoids extension-folder writes. |
| `Document.duplicate()` | Create an isolated reference-export document | Long-standing Photoshop ExtendScript DOM API. The original document remains untouched. |
| `Document.crop(bounds)` / `Document.flatten()` | Crop a temporary duplicate to the current selection and create one PNG surface | Applied only to the duplicate. Missing selection returns `NO_PHOTOSHOP_SELECTION`. |
| `Document.saveAs(File, PNGSaveOptions, ...)` | Export current canvas/selection reference PNG | Long-standing Photoshop ExtendScript DOM API; the duplicate closes with `DONOTSAVECHANGES`. |
| CEP file picker / Base64 read | Select a local PNG/JPEG reference | Uses `window.cep.fs.showOpenDialog` and `readFile` with magic-byte validation; no Node runtime. |

## CEF and Node capability

CEP 11 updated its embedded CEF to Chromium 88 and its optional Node runtime to 15.9.0. This extension does not pass `--enable-nodejs` or `--mixed-context`, does not package Node, and has no npm runtime dependencies. Browser capabilities are sufficient for Mock, CORS-permitted JSON APIs, transient PNG materialization, and the fixed CSInterface bridge.

Node must not be enabled merely to bypass CORS or TLS validation. Never add `--ignore-certificate-errors`. A future provider that genuinely needs local binary/file handling must receive a narrowly scoped architecture and security review first.

## Phase 7 provider/network decision

Phase 7 does not change `CSXS/manifest.xml`, the host range, CSXS 11, or `host.jsx`. The verified Photoshop mutation path still receives only a local PNG path.

## Phase 8 Generic Async Task compatibility decision

Phase 8 changes only the CEP client/provider layer. It adds plain JavaScript definitions, a localStorage-backed credential-free task metadata store, bounded extensions to the existing `PollingManager`, JSON fixtures, and host-independent tests. It does not change `CSXS/manifest.xml`, `host.jsx`, Photoshop layer placement, GRS New/Legacy routing, image payload optimization, HTTP 413 handling, or the PNG import contract.

The runtime uses APIs already exercised by the Photoshop 2024 / CEP 11 baseline: `XMLHttpRequest` through `ApiClient`, Promises/async functions, `setTimeout`, `localStorage`, JSON, and conservative ES syntax supported by CEF 88. It adds no Node runtime, bundler, ES modules, WebView, modern Clipboard dependency, or Photoshop 2025+ API. Dynamic polling/cancel endpoints are data resolved through the existing safe object-path parser; user JavaScript and `eval()` remain forbidden.

Replicate Predictions is a fixture-backed definition only. It is not registered in the runtime dropdown and automated verification cannot perform a real GRS or Replicate generation request. Existing GRS runtime code remains the Photoshop-tested Phase 7 implementation; its protocol is represented independently by the generic definition for equivalence tests, avoiding a high-risk migration during this phase.

- OpenAI-compatible mapping follows the official Images generation endpoint and fields, without a bundled API Key or Model ID.
- Generic REST mapping is declarative JSON plus safe object paths; no vendor endpoint is embedded in the core pipeline.
- API Keys remain session-only by default. Opt-in remembered keys use a separate `USER_DATA` sensitive-config file; Provider records are recursively stripped of credential-like fields before `localStorage`.
- Image URLs download as `ArrayBuffer`; URL and Base64 payloads are signature-checked before CEP fs writes them.
- The import boundary remains PNG-only. JPEG/WebP fail before `evalScript()` to preserve the tested Phase 6 host code.
- Async Task fields and polling timeout semantics are reserved, but submission/polling is not presented as implemented.
- Configuration checks do not call a chargeable generation endpoint.

Compatibility risk: CEP 11 CEF enforces CORS, and some APIs block browser-origin credentials. A trusted server-side proxy is the preferred fallback. This project does not disable web security, TLS verification, or Adobe security controls.

## Phase 7.2 GRS and Model Selector decision

Phase 7.2 changes only the CEP client layer. It does not change `CSXS/manifest.xml`, `host.jsx`, `PhotoshopBridge`, the PNG import contract, or the Photoshop document mutation path.

| Client feature | CEP 11 / Photoshop 25.0 status | Fallback / boundary |
|---|---|---|
| Native Model Selector | Supported by CEF 88 using HTML buttons, inputs, lists, keyboard events, and ARIA attributes | No framework or browser polyfill is required. Custom Model ID remains available when a service has no built-in catalog. |
| GRS `POST /v1/api/generate` | Uses the existing `XMLHttpRequest` JSON boundary | The API must permit the CEP browser origin. No TLS or CORS bypass is added. |
| GRS Bearer authentication | Uses the request-header builder and separated Secret Store | Keys are not written to Provider JSON; remembered keys are explicitly opt-in and diagnostic log objects mask API Key values. |
| GRS URL result | Reuses existing URL → transient PNG → `PhotoshopBridge.importImage()` | Non-PNG output is still rejected before the unchanged host bridge. |
| GRS asynchronous task state | `id`, `status`, `progress`, and `results` are parsed | Pending tasks use the documented `GET /v1/api/result?id=...`; minimal non-secret recovery metadata is retained. |

The default adapter uses `/v1/api/generate` for GRS model families so they share the documented `id/status/progress/results` response shape. Current catalog, New API, and Legacy API capabilities remain separate. Thirteen current image models are shown; legacy-only `nano-banana` remains compatibility metadata. Model IDs are never translated, and request fields are never inferred from suffixes.

Photoshop 2024 risk remains the CEP networking environment, not a Photoshop API dependency: CEF 88 may be rejected by an API's CORS policy. The offline Mock flow and all existing Photoshop operations remain unchanged and are the compatibility fallback.

## Phase 7.3R compatibility decision

This phase keeps Manifest 7.0, CSXS 11.0, the `[24.0,27.0)` host range, and the existing import bridge. It adds no Photoshop 2025+ API.

| Feature | Photoshop 25.0 / CEP 11 status | Boundary / fallback |
|---|---|---|
| 25 s connection, 180 s generation, 60 s download timeouts | Standard `XMLHttpRequest.timeout` in CEF 88 | Errors are separated into connection, generation, and download timeout codes. |
| Abortable request chain | Standard `XMLHttpRequest.abort()` | A cancellation token stops active XHR, polling, download, and subsequent automatic import. |
| GRS polling/recovery | Standard JSON XHR to the documented result endpoint | Requires the same valid session API Key; no credentials are persisted. Generic Async Task behavior is unchanged. |
| Custom dark dropdown | HTML buttons, ARIA, keyboard events, and native hidden `<select>` values | Native select values remain the source of truth; no framework or library. |
| Local reference | CEP 11 file picker and Base64 filesystem read | PNG/JPEG only; corrupt or mismatched content is rejected. |
| Canvas/selection reference | ExtendScript duplicate → optional crop → flatten → PNG save → close | Original document stays active and unchanged. No valid selection produces a localized error. |
| Reference-driven ratio | Pure JavaScript numeric resolver | Falls back to the first model-supported ratio when dimensions cannot be mapped. |

The primary manual risks are API CORS policy, a service taking longer than 600 seconds before returning any Task ID, and provider URLs returning non-PNG content while the verified Photoshop import bridge remains PNG-only. The offline Mock pipeline remains the no-network regression fallback.

### GRS request-lifecycle regression fix

CEF 88 `XMLHttpRequest.timeout` remains expressed in milliseconds. Request-level `600000` is resolved and assigned directly to the generation `xhr.timeout`; the client-level `25000` connection default cannot override it. UI/status observers execute after `xhr.send()` and are exception-isolated so view-layer errors cannot prevent a real POST. Synchronous `replyType=json` responses with `status=succeeded` return immediately and never enter Polling; only documented pending states with a Task ID enter GRS result recovery. This change uses standard CEP 11 browser APIs and adds no Photoshop host dependency.

## Phase 7.4R-H1 compatibility decision

CEP 11 synchronous `window.cep.fs` file reads/writes are used for remembered-Key bootstrap and read-after-write verification. No newer Photoshop API, Node.js API, or OS credential API was introduced. Image files are requested from CEP FS using its Base64 encoding mode; byte-array fallback conversion uses bounded loops without large `Function.apply`/spread calls. Image diagnostics are numeric/metadata-only. The 10-minute budget applies only to generation XHR and total polling; connection/query and download timeouts remain separately bounded. Manifest, `host.jsx`, and the Photoshop Import Core are unchanged.

## Phase 7.4R-H2 compatibility decision

This hotfix adds no Photoshop host API and leaves Manifest, Host range, `host.jsx`, Mock behavior, and the established import mutation path unchanged. Temporary request copies use CEF 88 `Image`, Canvas 2D `drawImage`, `getImageData`, and `toDataURL`, all available in the Photoshop 25.0 CEP 11 browser layer. If transparent pixels are present—or pixel inspection cannot reliably determine alpha—PNG is preserved. All resizing is proportional and limited to temporary API data.

The payload optimizer is provider-neutral and runs before the GRS adapter, so Nano Banana and GPT Image share identical input treatment. Output `resolutionTier` is independent from input-reference dimensions. The supplied GRS New API specification now confirms that GPT VIP must map the selected ratio/tier through its documented pixel matrix and send the resulting `widthxheight` value in `aspectRatio`; it still never sends `imageSize`. Ordinary `gpt-image-2` remains 1K-only and can send its documented ratio strings. HTTP 413 is handled by the existing CEF XHR load event as an immediate terminal error. Existing timeout boundaries remain generation/polling `600000 ms`, connection `25000 ms`, and download `60000 ms`.

## Phase 7.4R-H2.2 compatibility decision

GRS New API image generation now defaults to `replyType=async`. CEP 11 / CEF 88 performs the initial authenticated `POST /v1/api/generate` with a 25-second connection timeout, saves the returned Task ID, then polls authenticated `GET /v1/api/result?id=...` about every three seconds within the existing 600000 ms total window. Downloads remain 60000 ms. Cancellation aborts only local waiting, active XHR, polling, and download because the supplied New API documentation contains no server-cancel endpoint.

The New API parser reads only top-level `status`, `progress`, `results`, and `error`. The isolated Legacy adapter continues to use `POST /v1/draw/completions`, `urls[]`, `POST /v1/draw/result`, and `response.data`; it is not the normal generation route. HTTP 200 diagnostics use standard XHR metadata and a bounded sanitized preview. BOM, whitespace, empty, HTML, plain-text, stream-like, malformed JSON, and safely recoverable task-envelope cases are distinguished without any Photoshop host API. Manifest, `host.jsx`, Photoshop Import Core, H2 payload optimization, GPT pixel mapping, API Key persistence, History, Tabs, and Mock Provider remain unchanged.

## Phase 7.4R-H2.3 compatibility decision

The latest supplied official GRS OpenAPI facts confirm one New API image route for both Nano and GPT: `POST /v1/api/generate`, followed by authenticated `GET /v1/api/result?id=...`. The built-in GRS Provider is explicitly `protocol=new-api`; model-family selection controls only the body mapper. A lightweight allowlist validates the Nano and GPT body shapes before XHR. The separate `protocol=legacy-api` adapter retains Legacy GPT completions/result endpoints and `response.data` parsing but cannot be reached through New GPT family routing.

This alignment uses only existing CEP 11 / CEF 88 JavaScript and XHR. It adds no Photoshop host call and changes no timeout: async POST and each GET remain 25000 ms, total polling remains 600000 ms, and download remains 60000 ms. Endpoint/result diagnostics contain only bounded routing metadata and masked Task IDs. Manifest, Host range, `host.jsx`, Photoshop Import Core, Mock Provider, History, Tabs, API Key persistence, H2 Image Payload Optimizer, GPT Resolution Matrix, and HTTP 413 handling remain unchanged.

## Phase 7.4R compatibility decision

This phase adds only CEP 11 / CEF 88 JavaScript, HTML, CSS, `window.cep.fs`, and existing CSInterface path APIs. It does not change the Manifest, Host range, ExtendScript import core, or add a Photoshop 2025+ API.

| Feature | Photoshop 25.0 / CEP 11 status | Boundary / fallback |
|---|---|---|
| Owner-preserving native timers and XHR calls | Standard CEF 88 APIs | Mock-XHR tests enforce receiver context and callback isolation. |
| Main Image + eight references | Existing CEP picker and duplicate/crop/flatten export | Original document remains unchanged; PNG/JPEG input only. |
| Remember API Key | CEP USER_DATA filesystem | Plaintext-sensitive local file, opt-in only; session-only remains default. |
| API Key Credits | JSON XHR to the supplied GRS account endpoint | Failure is isolated from image generation; Account Token is not required. |
| Persistent History | CEP USER_DATA filesystem | 50-entry cap; permanent PNG copy; no API Keys or reference Base64. |
| Generate / Settings / History tabs | Mounted HTML sections and CSS | State is retained because panels are hidden, not recreated. |
| Legacy mapping metadata | Pure JavaScript request/result adapter | Not exposed as the default route; New API remains the normal path. |

## Phase 7.4R-H2.4 compatibility decision

This phase adds client-side state, CEP USER_DATA files, Canvas image fitting, and cache management only. It does not change `manifest.xml`, `host.jsx`, GRS request/result routing, polling, timeout budgets, resolution mappings, payload optimization, HTTP 413 handling, or the Photoshop import bridge.

| Feature | Photoshop 25.0 / CEP 11 status | Boundary / fallback |
|---|---|---|
| Shared model state | Provider config + in-memory subscribers | The Model ID has one persisted owner: existing Provider config. No second model key is created. |
| Task input snapshots | `window.cep.fs` under `PSAIImageHub/task-recovery` | Reuses the request's optimized image copies; retains seven days. Missing images never block Task GET. |
| Match Main Image size | CEF Canvas → temporary PNG → existing import bridge | Proportional Fit only, transparent padding when ratios differ, no crop/stretch, no PSD resize. Original result/history file is unchanged. |
| Storage/cache manager | `window.cep.fs.readdir/stat/deleteFile` + `SystemPath.USER_DATA` | Every deletion target is normalized and constrained to the `PSAIImageHub` root. API Key and Provider config categories are never image-clear targets. |

The Canvas and CEP filesystem calls are available in Photoshop 2024's CEP 11 / CEF 88 runtime. If Clipboard APIs are unavailable, the settings page leaves the actual path visible for manual copy. No Photoshop 2025+ API is used.

## Phase 7.4R-H2.4R startup hardening

Photoshop 25.0 host logs from the failed H2.4 launch contained no renderer JavaScript stack; they only recorded the host-level `User profile empty` message. The installed extension was verified to contain the same 61 files and hashes as staging, so missing runtime files and script-path casing were excluded.

H2.4R makes model state, recovery snapshots, storage scanning, Clipboard access, remembered-secret hydration, and import sizing independently degradable during bootstrap. Storage and recovery filesystem failures now return an unavailable/empty state instead of escaping into Panel bootstrap. Clipboard access remains feature-detected with the CEP-compatible `execCommand("copy")` fallback. The recovery filename formatter no longer depends on `String.prototype.padStart`.

Bootstrap now emits `BOOT_START`, each subsystem-ready event, `BOOT_UI_READY`, and a redacted `BOOT_FAILED` record with stage/file/line when available. These changes use ES2017-era syntax already used by the CEP project and avoid optional chaining, nullish coalescing, `Object.fromEntries`, `Promise.finally`, `URL`, and `URLSearchParams` in the H2.4 runtime modules.

## Phase 7.4R-H2.4R3 storage and placement correction

CEP 11 `window.cep.fs.stat()` is used only to identify files and directories for cache-category counts. Cache byte totals are intentionally not scanned or displayed, so Storage management does not require an ExtendScript `File.length` bridge. Category clearing remains restricted to known image-cache paths under the plugin data root.

Current Canvas and Current Selection Main inputs now retain submission-time document/selection bounds. The existing CEP Canvas temporary-copy step creates a document-sized transparent PNG, proportionally fits the result into the saved target bounds, and draws it at the corresponding absolute position. The existing `importImage(filePath)` host protocol remains unchanged; it still duplicates one layer and never resizes/crops the PSD. Local images without absolute bounds fall back to a document-centered target.

Clipboard uses feature-detected `navigator.clipboard.writeText()` and falls back after synchronous or asynchronous denial to a focused hidden textarea plus `document.execCommand("copy")`. Failure leaves the Unicode path visible for manual selection.

## Phase 8 recovery/history state isolation

Execution ownership uses plain ES2017 JavaScript objects, `localStorage` metadata, and the existing CEP filesystem-backed History store. It introduces no Photoshop DOM, ExtendScript, Manifest, network protocol, or modern browser API dependency. Recovery and snapshot regeneration use independent cancellation tokens and session records; stale callbacks are rejected by matching `executionId` and `historyId`. This is compatible with Photoshop 25.0 / CEP 11 / CEF 88.

## Phase 9 阿里云百炼 compatibility decision

Phase 9 adds only browser-side JSON/XHR, existing CEP-safe Base64 handling, existing Canvas-based input optimization, and the established CEP USER_DATA stores. It changes no Manifest entry, Host range, ExtendScript bridge, `host.jsx`, Photoshop import operation, GRS protocol, or global timeout policy.

| Feature | Photoshop 25.0 / CEP 11 status | Boundary / fallback |
|---|---|---|
| Regional endpoint | Plain string validation and concatenation | The Phase 9.0.1 platform Catalog retains Beijing, Singapore, Frankfurt, Tokyo, and Hong Kong IDs. Phase 9.0.2 filters new-task choices through each model's `supportedRegions`; both current Qwen Image models expose Beijing and Singapore. Missing or incompatible legacy settings fall back to `cn-beijing`, and Submit repeats the capability check before HTTP. Endpoint Builders still support all Catalog regions for historical Recovery and future models. |
| Async Submit and Poll | Existing CEF 88 `XMLHttpRequest` through `ApiClient` | Submit and each Poll use 25000 ms; total Poll remains 600000 ms with about a 3000 ms interval. |
| Qwen Image request mapping | Plain ES2017 objects and `JSON.stringify` | Images precede text; `parameters.size` uses `WIDTH*HEIGHT`; Auto omits `size`. |
| Main + References | Existing `ImageInputSet` and `ImagePayloadOptimizer` | At most three total images, maximum target edge 2048, maximum 10 MB each; over-limit requests fail before HTTP. |
| Result extraction | Definition-owned traversal of `output.choices[].message.content[].image` | All URLs are extracted; Phase 9 sends `n=1`, then immediately downloads the result into local History storage. |
| Task Recovery | Existing `AsyncTaskStore` and `PollingManager` | Stores the original Region, Workspace, absolute Poll URL, execution, History, and Task ID; Recovery uses that task context and never repeats Submit. UNKNOWN/expired tasks end with a readable error. |
| API Key persistence | Existing sensitive Provider configuration store | API Key is excluded from Provider config, History, recovery snapshots, task metadata, diagnostics, and logs. Workspace ID is non-secret normal config. |
| Local stop | Existing independent cancellation session | UI remains **停止等待**. No server-cancel UI is exposed in Phase 9. |

No Photoshop API is added, so no Photoshop 2025+ fallback is required. If Clipboard, storage statistics, or recovery snapshot files are unavailable, the existing startup degradation rules continue to keep Generate, Settings, and History available. Automated Phase 9 requests are fixture-backed; unmocked Bailian endpoints are rejected before transport.

## Prompt UI simplification compatibility decision

The prompt-optimization and separate text-service runtime has been removed. The Prompt text area now flows directly into the established Image Provider request builder, so this patch adds no CEP, Photoshop DOM, ExtendScript, network, or host dependency. New History and recovery snapshots store only `prompt` and `finalPrompt`; older records remain readable through `finalPrompt || prompt`. Legacy sensitive entries are neither loaded nor automatically deleted.

Provider capability controls are derived from the currently selected Image Provider and its current model on every selection change. Bailian-only expansion/thinking and service notices are therefore hidden immediately when switching to Mock or another provider, without changing Bailian request mapping.

## Phase 10P local Prompt Preset compatibility decision

Phase 10P is a client-only text composition feature. It uses the existing CEP JSON file dialog/read API, HTML form controls, `JSON.parse`, and browser `localStorage`; it adds no Photoshop DOM, ExtendScript, Manifest, host bridge, Provider request, network, or paid text-service dependency.

| Feature | Photoshop 25.0 / CEP 11 status | Boundary / fallback |
|---|---|---|
| Import local JSON | Existing `window.cep.fs.showOpenDialog` and `readFile` | JSON only. Empty, invalid, unsupported, or conflicting presets produce a localized error and do not change Provider settings. |
| Compatibility parser | Plain ES2017 string/object processing and `JSON.parse` | Supports outer arrays, nested JSON in `content`, and lightweight `@param` / module markers. Complex rules may degrade to static editable text. No `eval()` or `Function()` is allowed. |
| Dynamic controls | Existing HTML range, text, textarea, checkbox, and select elements | Hidden metadata is retained without rendering. No framework, web component, or browser polyfill is introduced. |
| Local Preset Store | CEP page `localStorage` | Stores Normalize results and recent ID only; never API Keys, network configuration, image Base64, or History image data. A missing or failing store degrades only the optional Preset area. |
| Prompt application | Pure local replace/append with exact normalized substring de-duplication | The compiled result is written to the existing Prompt textarea and remains editable. Generation continues to read that textarea directly. |

The Preset modules are isolated during bootstrap. If a file or storage implementation is unavailable, Generate, Settings, and History still mount without the Preset UI. No Photoshop 2025+ API is used, so Photoshop 2024 requires no new fallback.

## 10-minute image-task timeout patch

The GRS, Alibaba Cloud Model Studio, and provider-neutral Async Task definitions use a `600000 ms` total polling budget. The existing layered transport boundary is preserved: Submit and individual Poll requests remain `25000 ms`, while result downloads remain `60000 ms`. Total timeout stops only the local polling session and creates no automatic retry or second Submit; existing Task Recovery queries the original Task ID. This is plain timer logic in CEP 11 / CEF 88 and adds no Photoshop API or Photoshop 2025+ dependency.

## Phase 6 import decision

The selected implementation is **open PNG → duplicate its image layer into the original active document → close the PNG without saving**.

- Result type: ordinary Photoshop `ArtLayer` / pixel layer, not a Smart Object.
- Why this path: it uses the documented synchronous Photoshop ExtendScript DOM already available to CEP, preserves source pixel dimensions and aspect ratio, and avoids the placement transform and Smart Object semantics of Place Embedded.
- Why not `executeAction`: no Action Manager descriptor is needed for the required V1 behavior. The DOM path is easier to validate and does not couple the extension to undocumented event descriptors.
- Why not Place: Place Embedded normally introduces Smart Object behavior and may apply placement transforms relative to the current canvas. V1 requires a direct pixel-layer copy with no automatic scaling.
- Photoshop 2024 fallback: no newer Photoshop API is used. The same synchronous ExtendScript DOM path is the baseline implementation for Photoshop 25.0; `executeAsModal`, UXP, and `batchPlay` are not involved.

Layer numbering scans all top-level and nested layers in the active document on every import. It never relies only on CEP JavaScript memory. The import prepares the next `AI_Generated_###` name before mutating the target document and verifies that exactly one layer was added.

Windows paths are obtained from CEP with `SystemPath.EXTENSION`, normalized to native separators, validated as an in-extension relative asset path, and serialized as one escaped ExtendScript string argument. The fixed Bridge allowlist rejects arbitrary method names; null characters and unmatched Unicode surrogate code units are rejected before `evalScript()`.

## Manual Photoshop 25.0 checklist

1. Confirm **窗口 > 扩展（旧版） > PS AI Image Hub** appears after installing and restarting.
2. Confirm the panel docks, floats, resizes to 260 px width, closes, and reopens.
3. Confirm the default language is Simplified Chinese.
4. Click **刷新 Photoshop 状态** and confirm `ping`, version, no-document state, and active-document name.
5. Generate with an empty prompt and confirm a Chinese validation error.
6. Generate with a prompt and confirm `正在检查参数 → 正在提交 → 正在生成 → 生成完成`.
7. With no document open and automatic import enabled, confirm the PNG preview remains visible and the panel reports **当前没有打开 Photoshop 文档**.
8. Open a normal RGB document, click **重新导入**, and confirm exactly one ordinary pixel layer named `AI_Generated_001` appears.
9. Generate a second result and confirm the next layer is `AI_Generated_002`; existing layers and their names must remain unchanged.
10. Put an `AI_Generated_009` layer inside a nested group, generate again, and confirm the imported layer is `AI_Generated_010`.
11. Clear automatic import, generate, confirm no layer is added, then click **导入 Photoshop** and confirm one layer is added.
12. Confirm the imported image keeps its aspect ratio, the target canvas dimensions do not change, and no layer is flattened, merged, deleted, or overwritten.
13. Confirm the successful result displays the actual imported layer name and the button reads **已导入** rather than allowing an accidental duplicate click.
14. Confirm concurrent generation/import controls are blocked while their respective operations run.
15. Inspect CEP11/CEPHtmlEngine logs for uncaught errors and confirm no secrets appear.
16. Add an image API service, leave a required Model ID or API Key empty, and confirm a Chinese validation error with no network call.
17. Save a complete Provider, confirm it appears in the main selector, restart Photoshop, and confirm non-secret fields remain while API Key must be re-entered.
18. With an official funded test account and a CORS-permitted endpoint, generate a PNG and confirm preview → transient download → one `AI_Generated_###` layer.
19. Configure an invalid response path and confirm a JSON Path/response-format error while Mock remains usable.
20. Confirm the main label and settings actions use **API 服务**, while existing saved API services still load.
21. Select **GRS** in settings and confirm only node, API Key, confirmed model, and read-only advanced information are shown.
22. Switch GRS between global and China nodes and confirm the read-only Base URL becomes `https://grsaiapi.com` or `https://grsai.dakka.com.cn` without an automatic geographic choice.
23. Confirm the thirteen current Image Model IDs are selectable, including `nano-banana-2-lite`; confirm legacy-only `nano-banana` is not in the normal selector and models without confirmed size badges hide output resolution.
24. Open **＋ 自定义 Model ID…**, enter a non-secret test ID, choose its GRS request family, and confirm it becomes immediately selectable. Do not send a paid request unless the ID and family have been verified against current official documentation.
25. For Generic REST, add, edit, and delete display-name/Model-ID pairs, save, reopen settings, and confirm display names remain separate from exact IDs.
26. Before the first funded GRS call, confirm the account, active node, API Key, exact Model ID, expected charge, CORS support, and that the response is a PNG URL in the documented synchronous `succeeded/results` shape.
27. Confirm every dropdown is dark and readable at 260 px width, including API service, GRS model, request family, ratio, output resolution, node, auth, and result type.
28. Start a deliberately slow no-charge/mocked request and confirm the status distinguishes connecting, submitted, generating, 30/60-second waits, fetching, downloading, and importing; cancel once and confirm no download/import occurs afterward.
29. Add one local PNG/JPEG reference and confirm thumbnail, source, dimensions, replacement, and removal. Verify the request body contains one `images[]` value and no local filesystem path.
30. Export **当前画布**, then a valid **当前选区**. Confirm the original PSD dimensions, selection, layers, names, visibility, and saved state remain unchanged. With no selection, confirm the localized error appears.
31. Leave a pending GRS Task ID, restart the panel, re-enter the API Key, and confirm **恢复任务** continues through `GET /v1/api/result?id=...` without resubmitting generation.

## Adobe references

- Adobe CEP 11.1 HTML Extension Cookbook: https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/Documentation/CEP%2011.1%20HTML%20Extension%20Cookbook.md
- Adobe CEP 12 integration table: https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_12.x/Documentation/CEP%2012%20HTML%20Extension%20Cookbook.md
- Adobe CEP 11 Debugging Handbook: https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/Documentation/Debugging%20Handbook.md
- Adobe CEP Getting Started guide: https://github.com/Adobe-CEP/Getting-Started-guides
- Adobe CEP 11 `CSInterface.js` v11.0.0 (`SystemPath.EXTENSION`, `getSystemPath`, `evalScript`): https://github.com/Adobe-CEP/CEP-Resources/blob/master/CEP_11.x/CSInterface.js
- Adobe Photoshop developer overview for CEP and ECMAScript 3 ExtendScript: https://developer.adobe.com/photoshop/

## Phase 10Q Preset workflow compatibility decision

Phase 10Q adds no Photoshop DOM, ExtendScript, Manifest, Provider protocol, image payload, or network transport dependency. The runtime uses the existing CEP 11 file APIs (`showOpenDialog`, `readFile`, `showSaveDialogEx`, `writeFile`), browser `localStorage`, ordinary HTML controls, `JSON.parse`/`JSON.stringify`, and ES2017 syntax already used by the stable panel.

| Feature | Photoshop 25.0 / CEP 11 status | Boundary / fallback |
|---|---|---|
| Library, favorites, recent, rename, Stack | Plain local objects plus version-2 `localStorage` record | Phase 10P V1 Presets/recent ID migrate automatically. Store failure degrades only the optional Preset subsystem. |
| Semantic compilation and de-duplication | Local deterministic string processing | No AI, network, `eval()`, `Function()`, injected HTML, or Provider mutation. Explicit range descriptions take priority over the small generic mapper. |
| Preset import/export | CEP 11 filesystem dialogs and reads/writes | Missing file APIs produce a localized Preset error; Generate/Settings/History continue to run. Size/count limits are checked before library writes. |
| History metadata | Optional JSON fields on new entries | Old records can omit every new field. Restore still uses `finalPrompt || prompt`; Recovery and Stack are not coupled. |
| Connection check | Existing Provider `validateConfig()`/`testConnection()` configuration-only mode | No undocumented health endpoint, generation Submit, task, billing, or History write. UI states clearly that API Key validity was not verified. |
| Main Current Selection prompt constraint | Local final-Prompt composition | Default-on preference; affects only Main source type `current-selection`. No Mask/Inpainting schema, selection, dimensions, or Photoshop operation changes. |
| Stable/Dev channels | Development-only Node scripts outside runtime staging | Dev is hash-checked against source. Stable is changed only by an explicit promote command after integrity and regression pass. |

No Photoshop 2025+ API is introduced, so Photoshop 2024 requires no new fallback.
