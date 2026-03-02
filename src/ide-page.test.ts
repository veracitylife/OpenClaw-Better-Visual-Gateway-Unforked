import { describe, it, expect } from "vitest";
import { generateIdePage, EXTENSION_TO_LANGUAGE } from "./ide-page.js";

/**
 * Helper: extract the inline <script> JS from the generated HTML.
 * Grabs everything between the last <script> ... </script> block,
 * which is the IDE application code (not the Monaco loader tag).
 */
function extractInlineJs(html: string): string {
  // The IDE app script is the last <script>...</script> block
  const lastScriptClose = html.lastIndexOf("</script>");
  const scriptOpenBefore = html.lastIndexOf("<script>", lastScriptClose);
  if (scriptOpenBefore === -1 || lastScriptClose === -1) {
    throw new Error("Could not find inline <script> block in generated HTML");
  }
  return html.slice(scriptOpenBefore + "<script>".length, lastScriptClose);
}

describe("IDE Page Generator", () => {
  // ---- Generated JS correctness (would have caught the regex escaping bug) ----

  describe("generated JavaScript validity", () => {
    it("should produce syntactically valid JavaScript", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      // new Function() parses without executing -- throws SyntaxError if invalid
      expect(() => new Function(js)).not.toThrow();
    });

    it("should produce valid JS with all config combinations", () => {
      const configs = [
        {},
        { monacoVersion: "0.45.0" },
        { theme: "vs" as const },
        { theme: "hc-black" as const },
        { monacoVersion: "0.50.0", theme: "vs" as const },
      ];
      for (const config of configs) {
        const html = generateIdePage(config);
        const js = extractInlineJs(html);
        expect(() => new Function(js), `config ${JSON.stringify(config)}`).not.toThrow();
      }
    });

    it("should correctly handle backslash conversion in normalizeWorkspaceRoot", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      // normalizeWorkspaceRoot converts backslashes to forward slashes.
      // Implementation uses String.fromCharCode(92) to avoid template escaping issues.
      expect(js).toContain("String.fromCharCode(92)");
    });
  });

  // ---- Monaco loading resilience ----

  describe("Monaco loader resilience", () => {
    it("should use CDN fallback sources for the AMD loader", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      // ensureMonacoLoader should try jsdelivr and unpkg CDNs
      expect(js).toContain("cdn.jsdelivr.net/npm/monaco-editor");
      expect(js).toContain("unpkg.com/monaco-editor");
      // local Monaco assets should NOT be referenced (removed to reduce package size)
      expect(js).not.toContain("/better-gateway/monaco/");
    });

    it("should track which loader source succeeded and reuse it for editor modules", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      // monacoBase must be set when loader succeeds and used in loadMonacoEditor
      expect(js).toContain("monacoBase = base");
      expect(js).toContain("paths: { vs: monacoBase }");
    });

    it("should not try multiple bases in loadMonacoEditor to avoid AMD cache poisoning", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      // loadMonacoEditor should call require() exactly once with monacoBase,
      // NOT iterate through multiple bases (which poisons the AMD module cache).
      const loadMonacoFn = js.slice(
        js.indexOf("function loadMonacoEditor"),
        js.indexOf("function init")
      );
      // Should NOT contain tryNext or idx++ patterns (old multi-try approach)
      expect(loadMonacoFn).not.toContain("tryNext");
      expect(loadMonacoFn).not.toContain("idx++");
      // Should contain a single require call with monacoBase
      expect(loadMonacoFn).toContain("monacoBase");
    });
  });

  // ---- Error handling ----

  describe("init error handling", () => {
    it("should wrap init body in try/catch", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      const initFn = js.slice(js.indexOf("async function init"));
      expect(initFn).toContain("try {");
      expect(initFn).toContain("} catch");
    });

    it("should show a visible error when loading fails (remove hidden class)", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      // showLoadingError must remove the hidden class so the error overlay
      // is visible even after the loading spinner was already dismissed
      expect(js).toContain("classList.remove('hidden')");
    });

    it("should display a retry button on error", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      expect(js).toContain("Retry");
      expect(js).toContain("location.reload()");
    });

    it("should guard localStorage.getItem/JSON.parse during tab restore", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      // The tab restoration block must be in its own try/catch so corrupted
      // localStorage doesn't crash init and leave the spinner spinning
      const initFn = js.slice(js.indexOf("async function init"));
      const tabRestore = initFn.slice(initFn.indexOf("Restore open tabs"));
      expect(tabRestore).toContain("try {");
      expect(tabRestore).toContain("JSON.parse");
      expect(tabRestore).toContain("} catch");
    });

    it("should guard view state restoration in switchToTab", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      const switchFn = js.slice(
        js.indexOf("async function switchToTab"),
        js.indexOf("function closeTab")
      );
      // restoreViewState + JSON.parse must be inside try/catch
      expect(switchFn).toContain("restoreViewState");
      expect(switchFn).toContain("try {");
      expect(switchFn).toContain("} catch");
    });

    it("should guard localStorage.setItem calls against quota errors", () => {
      const html = generateIdePage();
      const js = extractInlineJs(html);
      // The saveTabs periodic function should be guarded
      const saveTabs = js.slice(js.indexOf("const saveTabs"));
      expect(saveTabs).toContain("try {");
      expect(saveTabs).toContain("localStorage.setItem");
      expect(saveTabs).toContain("} catch");
    });
  });

  // ---- Config interpolation ----

  describe("config interpolation", () => {
    it("should interpolate the default Monaco version into CDN URLs", () => {
      const html = generateIdePage();
      expect(html).toContain("monaco-editor@0.52.0");
    });

    it("should interpolate a custom Monaco version", () => {
      const html = generateIdePage({ monacoVersion: "0.45.0" });
      expect(html).toContain("monaco-editor@0.45.0");
      expect(html).not.toContain("monaco-editor@0.52.0");
    });

    it("should interpolate the theme into editor creation", () => {
      const html = generateIdePage({ theme: "hc-black" });
      expect(html).toContain("theme: 'hc-black'");
    });
  });

  // ---- Structural sanity (consolidated from old granular checks) ----

  describe("page structure", () => {
    it("should generate a complete HTML document", () => {
      const html = generateIdePage();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("</html>");
    });

    it("should include core layout elements", () => {
      const html = generateIdePage();
      for (const id of [
        "app", "toolbar", "sidebar", "file-tree", "editor-container",
        "tab-bar", "welcome", "loading", "context-menu", "resize-handle",
      ]) {
        expect(html, `missing #${id}`).toContain(`id="${id}"`);
      }
    });

    it("should include the file API base URL", () => {
      const html = generateIdePage();
      expect(html).toContain("/better-gateway/api/files");
    });
  });

  // ---- Extension mapping (real unit tests -- keep as-is) ----

  describe("EXTENSION_TO_LANGUAGE mapping", () => {
    it("should map TypeScript extensions", () => {
      expect(EXTENSION_TO_LANGUAGE.ts).toBe("typescript");
      expect(EXTENSION_TO_LANGUAGE.tsx).toBe("typescript");
    });

    it("should map JavaScript extensions", () => {
      expect(EXTENSION_TO_LANGUAGE.js).toBe("javascript");
      expect(EXTENSION_TO_LANGUAGE.jsx).toBe("javascript");
    });

    it("should map common file types", () => {
      expect(EXTENSION_TO_LANGUAGE.json).toBe("json");
      expect(EXTENSION_TO_LANGUAGE.md).toBe("markdown");
      expect(EXTENSION_TO_LANGUAGE.html).toBe("html");
      expect(EXTENSION_TO_LANGUAGE.css).toBe("css");
      expect(EXTENSION_TO_LANGUAGE.py).toBe("python");
    });

    it("should map shell scripts", () => {
      expect(EXTENSION_TO_LANGUAGE.sh).toBe("shell");
      expect(EXTENSION_TO_LANGUAGE.bash).toBe("shell");
      expect(EXTENSION_TO_LANGUAGE.zsh).toBe("shell");
    });

    it("should map config files", () => {
      expect(EXTENSION_TO_LANGUAGE.yaml).toBe("yaml");
      expect(EXTENSION_TO_LANGUAGE.yml).toBe("yaml");
      expect(EXTENSION_TO_LANGUAGE.toml).toBe("toml");
      expect(EXTENSION_TO_LANGUAGE.ini).toBe("ini");
    });
  });
});
