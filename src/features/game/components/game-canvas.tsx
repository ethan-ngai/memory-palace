import { useEffect, useRef } from "react";
import "@/features/game/styles/anchor-tagger.css";

/**
 * Returns a strongly typed DOM node and fails fast when the JSX shell is incomplete.
 * @param value - Ref target produced by React.
 * @param name - Human-readable element label for debugging.
 * @returns The resolved DOM node.
 */
function requireElement<T>(value: T | null, name: string) {
  if (!value) {
    throw new Error(`Missing anchor tagger element: ${name}`);
  }
  return value;
}

/**
 * Renders the Memory Palace anchor-tagging workspace and mounts the imperative Three.js runtime.
 * @returns SSR-safe editor shell whose browser-only behavior is attached after hydration.
 */
export function GameCanvas() {
  const dragOverlayRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dropMessageRef = useRef<HTMLDivElement>(null);
  const loadingOverlayRef = useRef<HTMLDivElement>(null);
  const loadMessageRef = useRef<HTMLSpanElement>(null);
  const loadSubMessageRef = useRef<HTMLSpanElement>(null);
  const modeBadgeRef = useRef<HTMLDivElement>(null);
  const hudAnchorsRef = useRef<HTMLDivElement>(null);
  const filePointPillRef = useRef<HTMLDivElement>(null);
  const anchorCountPillRef = useRef<HTMLDivElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileLoadedRef = useRef<HTMLDivElement>(null);
  const anchorLabelInputRef = useRef<HTMLInputElement>(null);
  const anchorSurfaceSelectRef = useRef<HTMLSelectElement>(null);
  const btnOrbitRef = useRef<HTMLButtonElement>(null);
  const btnPlaceRef = useRef<HTMLButtonElement>(null);
  const btnLoadPropRef = useRef<HTMLButtonElement>(null);
  const propFileInputRef = useRef<HTMLInputElement>(null);
  const propLoadedRef = useRef<HTMLDivElement>(null);
  const propCountInputRef = useRef<HTMLInputElement>(null);
  const btnScatterRef = useRef<HTMLButtonElement>(null);
  const btnRerollRef = useRef<HTMLButtonElement>(null);
  const btnClearPropsRef = useRef<HTMLButtonElement>(null);
  const btnExportRef = useRef<HTMLButtonElement>(null);
  const btnPerfRef = useRef<HTMLButtonElement>(null);
  const btnClearAllRef = useRef<HTMLButtonElement>(null);
  const taggedCountStatRef = useRef<HTMLSpanElement>(null);
  const pointCountStatRef = useRef<HTMLSpanElement>(null);
  const anchorListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let dispose = () => {};
    void import("@/features/game/engine/anchor-tagger").then(({ createAnchorTagger }) => {
      if (disposed) {
        return;
      }

      const controller = createAnchorTagger({
        anchorCountPill: requireElement(anchorCountPillRef.current, "anchorCountPill"),
        anchorLabelInput: requireElement(anchorLabelInputRef.current, "anchorLabelInput"),
        anchorList: requireElement(anchorListRef.current, "anchorList"),
        anchorSurfaceSelect: requireElement(anchorSurfaceSelectRef.current, "anchorSurfaceSelect"),
        btnClearAll: requireElement(btnClearAllRef.current, "btnClearAll"),
        btnClearProps: requireElement(btnClearPropsRef.current, "btnClearProps"),
        btnExport: requireElement(btnExportRef.current, "btnExport"),
        btnLoadProp: requireElement(btnLoadPropRef.current, "btnLoadProp"),
        btnOrbit: requireElement(btnOrbitRef.current, "btnOrbit"),
        btnPerf: requireElement(btnPerfRef.current, "btnPerf"),
        btnPlace: requireElement(btnPlaceRef.current, "btnPlace"),
        btnReroll: requireElement(btnRerollRef.current, "btnReroll"),
        btnScatter: requireElement(btnScatterRef.current, "btnScatter"),
        dragOverlay: requireElement(dragOverlayRef.current, "dragOverlay"),
        dropMessage: requireElement(dropMessageRef.current, "dropMessage"),
        dropzone: requireElement(dropzoneRef.current, "dropzone"),
        fileInput: requireElement(fileInputRef.current, "fileInput"),
        fileLoaded: requireElement(fileLoadedRef.current, "fileLoaded"),
        filePointPill: requireElement(filePointPillRef.current, "filePointPill"),
        hudAnchors: requireElement(hudAnchorsRef.current, "hudAnchors"),
        loadMessage: requireElement(loadMessageRef.current, "loadMessage"),
        loadingOverlay: requireElement(loadingOverlayRef.current, "loadingOverlay"),
        loadSubMessage: requireElement(loadSubMessageRef.current, "loadSubMessage"),
        modeBadge: requireElement(modeBadgeRef.current, "modeBadge"),
        taggedCountStat: requireElement(taggedCountStatRef.current, "taggedCountStat"),
        pointCountStat: requireElement(pointCountStatRef.current, "pointCountStat"),
        propCountInput: requireElement(propCountInputRef.current, "propCountInput"),
        propFileInput: requireElement(propFileInputRef.current, "propFileInput"),
        propLoaded: requireElement(propLoadedRef.current, "propLoaded"),
        viewport: requireElement(viewportRef.current, "viewport"),
      });
      dispose = () => controller.dispose();
    });

    return () => {
      disposed = true;
      dispose();
    };
  }, []);

  return (
    <section className="anchor-tagger-shell">
      <div className="anchor-tagger-drag-overlay" ref={dragOverlayRef}>
        <div className="big">⬡</div>
        <div>DROP .SPZ OR .PLY FILE</div>
      </div>

      <header className="anchor-tagger-header panel">
        <h1>Memory Palace · Anchor Tagger</h1>
        <div className="pill" ref={filePointPillRef}>
          No file loaded
        </div>
        <div className="pill live" ref={anchorCountPillRef} style={{ display: "none" }}>
          0 anchors tagged
        </div>
      </header>

      <div className="anchor-tagger-workspace">
        <div className="anchor-tagger-viewport" ref={viewportRef}>
          <div className="drop-msg" ref={dropMessageRef}>
            <div className="big">⬡</div>
            <div>Drop a .spz or .ply file anywhere, or use the sidebar</div>
          </div>
          <div className="loading" ref={loadingOverlayRef}>
            <div className="spinner"></div>
            <span ref={loadMessageRef}>Loading...</span>
            <span id="load-sub" ref={loadSubMessageRef}></span>
          </div>
          <div className="hud mode-badge" ref={modeBadgeRef}>
            ORBIT
          </div>
          <div className="hud hud-anchors" ref={hudAnchorsRef}></div>
          <div className="hud hud-hint">
            Orbit: <kbd>drag</kbd> · Pan: <kbd>right-drag</kbd> / <kbd>WASD</kbd> · Zoom:{" "}
            <kbd>scroll</kbd> · Tag: <kbd>P</kbd> · Drag anchors to reposition · Undo:{" "}
            <kbd>Ctrl+Z</kbd>
          </div>
        </div>

        <div className="anchor-tagger-sidebar panel">
          <div className="sb">
            <h2>Scene File</h2>
            <div className="dropzone" ref={dropzoneRef}>
              <div className="dz-icon">⬡</div>
              <p>
                Click to browse or drop
                <br />
                <strong>.spz</strong> / <strong>.ply</strong> anywhere
              </p>
            </div>
            <input ref={fileInputRef} type="file" accept=".spz,.ply" />
            <div className="fmt-badges">
              <span className="fmt-badge spz">SPZ ✓</span>
              <span className="fmt-badge ply">PLY ✓</span>
            </div>
            <div ref={fileLoadedRef} className="file-loaded"></div>
          </div>

          <div className="sb">
            <h2>Tag Settings</h2>
            <input
              ref={anchorLabelInputRef}
              type="text"
              placeholder="Label (e.g. Desk, Shelf, Chair...)"
            />
            <select ref={anchorSurfaceSelectRef} defaultValue="surface">
              <option value="surface">Surface — generic flat area</option>
              <option value="wall">Wall — vertical surface</option>
              <option value="floor">Floor — ground level</option>
              <option value="furniture">Furniture — objects/furniture</option>
              <option value="ceiling">Ceiling — overhead</option>
              <option value="window">Window / Opening</option>
              <option value="other">Other</option>
            </select>
            <div className="btn-grid">
              <button ref={btnOrbitRef} className="btn active" type="button">
                ⊕ Orbit
              </button>
              <button ref={btnPlaceRef} className="btn" type="button">
                ⊞ Tag [P]
              </button>
            </div>
          </div>

          <div className="sb">
            <h2>Object Scatter</h2>
            <button ref={btnLoadPropRef} className="btn full" type="button">
              ↑ Load .glb Prop
            </button>
            <input ref={propFileInputRef} type="file" accept=".glb" />
            <div ref={propLoadedRef} className="file-loaded"></div>
            <div className="mini-label">Copies To Place</div>
            <input ref={propCountInputRef} type="number" min="1" step="1" />
            <div className="btn-grid">
              <button ref={btnScatterRef} className="btn" type="button">
                Scatter
              </button>
              <button ref={btnRerollRef} className="btn" type="button">
                Re-roll
              </button>
            </div>
            <button ref={btnClearPropsRef} className="btn full danger" type="button">
              ✕ Clear Props
            </button>
          </div>

          <div className="sb">
            <button ref={btnExportRef} className="btn full export" type="button">
              ↓ Export anchors.json
            </button>
            <button ref={btnPerfRef} className="btn full perf active" type="button">
              ⚡ Performance Mode: On
            </button>
            <button ref={btnClearAllRef} className="btn full danger" type="button">
              ✕ Clear all anchors
            </button>
          </div>

          <div className="sb">
            <div className="stats">
              <div>
                Tagged:{" "}
                <span className="val g" ref={taggedCountStatRef}>
                  0
                </span>
              </div>
              <div>
                Points:{" "}
                <span className="val" ref={pointCountStatRef}>
                  —
                </span>
              </div>
            </div>
          </div>

          <div className="anchor-scroll" ref={anchorListRef}>
            <div
              className="empty-msg"
              dangerouslySetInnerHTML={{
                __html:
                  "No anchors yet.<br />Load a .spz or .ply file,<br />switch to Tag mode,<br />and click surfaces.",
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
