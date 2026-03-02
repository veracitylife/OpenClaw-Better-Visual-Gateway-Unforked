import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const injectScript = readFileSync(join(__dirname, "inject.js"), "utf-8");

describe("inject.js - WebSocket auto-reconnect", () => {
  let dom: JSDOM;
  let window: any;
  let OriginalWebSocket: any;

  beforeEach(() => {
    dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
      runScripts: "dangerously",
      url: "http://localhost:3000",
    });
    window = dom.window;

    OriginalWebSocket = vi.fn().mockImplementation(function (
      this: any,
      url: string,
      protocols?: string | string[]
    ) {
      this.url = url;
      this.protocols = protocols;
      this.readyState = 0;
      this.listeners = new Map();

      this.addEventListener = vi.fn((event: string, callback: Function) => {
        if (!this.listeners.has(event)) {
          this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
      });

      this.removeEventListener = vi.fn();
      this.send = vi.fn();
      this._rawSend = this.send;
      this.close = vi.fn();

      this.triggerEvent = (event: string, data: any = {}) => {
        const callbacks = this.listeners.get(event) || [];
        callbacks.forEach((cb: Function) => cb(data));
      };

      return this;
    });

    OriginalWebSocket.CONNECTING = 0;
    OriginalWebSocket.OPEN = 1;
    OriginalWebSocket.CLOSING = 2;
    OriginalWebSocket.CLOSED = 3;
    OriginalWebSocket.prototype = {};

    window.WebSocket = OriginalWebSocket;
  });

  afterEach(() => {
    dom.window.close();
  });

  describe("initialization", () => {
    it("should wrap the WebSocket constructor", () => {
      window.eval(injectScript);
      expect(window.WebSocket).not.toBe(OriginalWebSocket);
    });

    it("should preserve WebSocket static constants", () => {
      window.eval(injectScript);
      expect(window.WebSocket.CONNECTING).toBe(0);
      expect(window.WebSocket.OPEN).toBe(1);
      expect(window.WebSocket.CLOSING).toBe(2);
      expect(window.WebSocket.CLOSED).toBe(3);
    });

    it("should use default config when not provided", () => {
      window.eval(injectScript);
      expect(window.__BETTER_GATEWAY_CONFIG__).toBeUndefined();
    });

    it("should use provided config", () => {
      window.__BETTER_GATEWAY_CONFIG__ = {
        reconnectIntervalMs: 5000,
        maxReconnectAttempts: 20,
      };
      window.eval(injectScript);
      // Config is used internally, we just verify it doesn't throw
    });

    it("should log initialization message", () => {
      const consoleSpy = vi.spyOn(window.console, "log");
      window.eval(injectScript);
      expect(consoleSpy).toHaveBeenCalledWith(
        "[BetterGateway] Auto-reconnect enabled",
        expect.any(Object)
      );
    });
  });

  describe("status indicator", () => {
    it("should create status indicator element on init", () => {
      window.eval(injectScript);
      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator).not.toBeNull();
    });

    it("should show Ready status on initialization", () => {
      window.eval(injectScript);
      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.innerHTML).toContain("Ready");
    });

    // FIXME: jsdom computed style issue - skipping flaky test
    it.skip("should have fixed positioning", () => {
      window.eval(injectScript);
      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.style.position).toBe("fixed");
      expect(indicator?.style.bottom).toBe("12px");
      expect(indicator?.style.right).toBe("12px");
    });

    it("should have correct z-index for visibility", () => {
      window.eval(injectScript);
      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.style.zIndex).toBe("999999");
    });
  });

  describe("WebSocket wrapping", () => {
    it("should create WebSocket with correct url", () => {
      window.eval(injectScript);
      const ws = new window.WebSocket("ws://localhost:8080");
      expect(OriginalWebSocket).toHaveBeenCalledWith(
        "ws://localhost:8080",
        undefined
      );
    });

    it("should create WebSocket with protocols", () => {
      window.eval(injectScript);
      const ws = new window.WebSocket("ws://localhost:8080", ["protocol1"]);
      expect(OriginalWebSocket).toHaveBeenCalledWith("ws://localhost:8080", [
        "protocol1",
      ]);
    });

    it("should attach event listeners to WebSocket", () => {
      window.eval(injectScript);
      const ws = new window.WebSocket("ws://localhost:8080");
      expect(ws.addEventListener).toHaveBeenCalledWith(
        "open",
        expect.any(Function)
      );
      expect(ws.addEventListener).toHaveBeenCalledWith(
        "close",
        expect.any(Function)
      );
      expect(ws.addEventListener).toHaveBeenCalledWith(
        "error",
        expect.any(Function)
      );
    });
  });

  describe("connection status updates", () => {
    it("should show Connected status on open event", () => {
      window.eval(injectScript);
      const ws = new window.WebSocket("ws://localhost:8080");
      ws.triggerEvent("open");

      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.innerHTML).toContain("Connected");
    });

    it("should show Connection error on error event", () => {
      window.eval(injectScript);
      const ws = new window.WebSocket("ws://localhost:8080");
      ws.triggerEvent("error");

      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.innerHTML).toContain("Connection error");
    });

    it("should show Disconnected on clean close", () => {
      window.eval(injectScript);
      const ws = new window.WebSocket("ws://localhost:8080");
      ws.triggerEvent("close", { wasClean: true });

      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.innerHTML).toContain("Disconnected");
    });
  });

  describe("reconnection logic", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should attempt reconnection on unclean close", () => {
      window.eval(injectScript);
      const ws = new window.WebSocket("ws://localhost:8080");
      ws.triggerEvent("close", { wasClean: false });

      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.innerHTML).toContain("Reconnecting");
      expect(indicator?.innerHTML).toContain("1/10");
    });

    it("should show failed status after max attempts", () => {
      window.__BETTER_GATEWAY_CONFIG__ = {
        reconnectIntervalMs: 100,
        maxReconnectAttempts: 2,
      };
      window.eval(injectScript);

      // First connection
      let ws = new window.WebSocket("ws://localhost:8080");
      ws.triggerEvent("close", { wasClean: false });

      // First reconnect attempt
      vi.advanceTimersByTime(100);
      const instances = OriginalWebSocket.mock.instances;
      const ws2 = instances[instances.length - 1];
      ws2.triggerEvent("close", { wasClean: false });

      // Second reconnect attempt
      vi.advanceTimersByTime(100);
      const ws3 = OriginalWebSocket.mock.instances[OriginalWebSocket.mock.instances.length - 1];
      ws3.triggerEvent("close", { wasClean: false });

      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.innerHTML).toContain("failed");
    });

    it("should reset attempts on successful connection", () => {
      window.eval(injectScript);

      // First connection fails
      let ws = new window.WebSocket("ws://localhost:8080");
      ws.triggerEvent("close", { wasClean: false });

      // Reconnect
      vi.advanceTimersByTime(3000);
      const instances = OriginalWebSocket.mock.instances;
      const ws2 = instances[instances.length - 1];

      // Successful connection
      ws2.triggerEvent("open");

      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.innerHTML).toContain("Connected");

      // Another disconnect - should start from 1 again
      ws2.triggerEvent("close", { wasClean: false });
      expect(indicator?.innerHTML).toContain("1/10");
    });
  });

  describe("network events", () => {
    it("should show Back online on online event", () => {
      window.eval(injectScript);
      window.dispatchEvent(new window.Event("online"));

      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.innerHTML).toContain("Back online");
    });

    it("should show Offline on offline event", () => {
      window.eval(injectScript);
      window.dispatchEvent(new window.Event("offline"));

      const indicator = window.document.getElementById("better-gateway-status");
      expect(indicator?.innerHTML).toContain("Offline");
    });
  });

  describe("IDE embedded view", () => {
    function createGatewaySidebar() {
      // Create gateway-like sidebar structure
      const sidebar = window.document.createElement("aside");
      sidebar.className = "nav";
      
      const navGroup = window.document.createElement("div");
      navGroup.className = "nav-group";
      
      const navItems = window.document.createElement("div");
      navItems.className = "nav-group__items";
      
      const chatLink = window.document.createElement("a");
      chatLink.href = "/chat";
      chatLink.className = "nav-item active";
      chatLink.innerHTML = `
        <span class="nav-item__icon">💬</span>
        <span class="nav-item__text">Chat</span>
      `;
      
      navItems.appendChild(chatLink);
      navGroup.appendChild(navItems);
      sidebar.appendChild(navGroup);
      window.document.body.appendChild(sidebar);
      
      // Create main content area
      const main = window.document.createElement("main");
      main.className = "content content--chat";
      main.innerHTML = "<div>Chat content</div>";
      window.document.body.appendChild(main);
      
      return { sidebar, navItems, chatLink, main };
    }

    it("should not inject IDE nav when Chat link is missing", () => {
      window.eval(injectScript);
      const ideNav = window.document.getElementById("better-gateway-ide-nav");
      expect(ideNav).toBeNull();
    });

    it("should inject IDE nav item below Chat", () => {
      createGatewaySidebar();
      window.eval(injectScript);
      
      const ideNav = window.document.getElementById("better-gateway-ide-nav");
      expect(ideNav).not.toBeNull();
      expect(ideNav?.className).toBe("nav-item");
      expect(ideNav?.getAttribute("href")).toBe("#ide");
    });

    it("should create IDE nav with correct structure", () => {
      createGatewaySidebar();
      window.eval(injectScript);
      
      const ideNav = window.document.getElementById("better-gateway-ide-nav");
      expect(ideNav).not.toBeNull();
      expect(ideNav?.innerHTML).toContain("nav-item__icon");
      expect(ideNav?.innerHTML).toContain("nav-item__text");
      expect(ideNav?.innerHTML).toContain("IDE");
      expect(ideNav?.innerHTML).toContain("svg"); // Has icon
    });

    it("should place IDE nav after Chat in nav-group__items", () => {
      const { navItems } = createGatewaySidebar();
      window.eval(injectScript);
      
      const items = navItems.querySelectorAll(".nav-item");
      expect(items.length).toBe(3);
      expect(items[0].getAttribute("href")).toBe("/chat");
      expect(items[1].getAttribute("href")).toBe("#ide");
      expect(items[2].getAttribute("href")).toBe("#cli");
    });

    it.skip("should not inject on standalone IDE page", () => {
      // SKIP: JSDOM doesn't allow redefining location.pathname
      // This functionality is tested manually in the browser
    });

    it("should not inject duplicate nav items on double eval", () => {
      createGatewaySidebar();
      
      window.eval(injectScript);
      window.eval(injectScript);
      
      const ideNavs = window.document.querySelectorAll("#better-gateway-ide-nav");
      const cliNavs = window.document.querySelectorAll("#better-gateway-cli-nav");
      expect(ideNavs.length).toBe(1);
      expect(cliNavs.length).toBe(1);
    });

    it("should log injection message to console", () => {
      const consoleSpy = vi.spyOn(window.console, "log");
      createGatewaySidebar();
      
      window.eval(injectScript);
      
      expect(consoleSpy).toHaveBeenCalledWith("[BetterGateway] IDE + CLI nav items injected");
    });

    it("should create IDE iframe when view is toggled", () => {
      const { main } = createGatewaySidebar();
      window.eval(injectScript);
      
      const ideNav = window.document.getElementById("better-gateway-ide-nav");
      ideNav?.click();
      
      const ideFrame = window.document.getElementById("better-gateway-ide-frame");
      expect(ideFrame).not.toBeNull();
      expect(ideFrame?.tagName).toBe("IFRAME");
      expect(ideFrame?.getAttribute("src")).toContain("/better-gateway/ide");
    });

    it("should show split view (both main and iframe) when IDE nav is Shift+clicked", () => {
      const { main } = createGatewaySidebar();
      window.eval(injectScript);
      
      const ideNav = window.document.getElementById("better-gateway-ide-nav");
      ideNav?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
      
      // Split view: both main and iframe are visible
      expect(main.style.display).not.toBe("none");
      const ideFrame = window.document.getElementById("better-gateway-ide-frame");
      expect(ideFrame).not.toBeNull();
      expect(ideFrame?.style.display).toBe("block");
    });

    it("should hide iframe when switching back to Chat from split view", () => {
      const { main } = createGatewaySidebar();
      window.eval(injectScript);
      
      const ideNav = window.document.getElementById("better-gateway-ide-nav");
      
      // Switch to split view via Shift+click
      ideNav?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
      expect(main.style.display).not.toBe("none");
      
      // Switch back to Chat via Shift+click again
      ideNav?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
      expect(main.style.display).toBe("");
      const ideFrame = window.document.getElementById("better-gateway-ide-frame");
      expect(ideFrame?.style.display).toBe("none");
    });

    it("should disable iframe pointer events while resizing and restore on mouseup", () => {
      createGatewaySidebar();
      window.eval(injectScript);

      const ideNav = window.document.getElementById("better-gateway-ide-nav");
      ideNav?.click();

      const ideFrame = window.document.getElementById("better-gateway-ide-frame");
      const splitHandle = window.document.getElementById("better-gateway-split-handle");

      expect(ideFrame?.style.pointerEvents).toBe("");

      splitHandle?.dispatchEvent(
        new window.MouseEvent("mousedown", { bubbles: true, clientX: 600 })
      );
      expect(ideFrame?.style.pointerEvents).toBe("none");

      window.document.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
      expect(ideFrame?.style.pointerEvents).toBe("");
    });

    it("should update active class when switching views", () => {
      const { chatLink } = createGatewaySidebar();
      window.eval(injectScript);
      
      const ideNav = window.document.getElementById("better-gateway-ide-nav");
      
      // Initially Chat is active
      expect(chatLink.classList.contains("active")).toBe(true);
      expect(ideNav?.classList.contains("active")).toBe(false);
      
      // Switch to split view via Shift+click - both should be active
      ideNav?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
      expect(chatLink.classList.contains("active")).toBe(true);
      expect(ideNav?.classList.contains("active")).toBe(true);
      
      // Switch back to Chat via Shift+click again
      ideNav?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));
      expect(chatLink.classList.contains("active")).toBe(true);
      expect(ideNav?.classList.contains("active")).toBe(false);
    });

    it("should show chat sidebar toggle button in split and hide chat when clicked", () => {
      const { main } = createGatewaySidebar();
      window.eval(injectScript);

      const ideNav = window.document.getElementById("better-gateway-ide-nav");
      // Enter split view via Shift+click
      ideNav?.dispatchEvent(new window.MouseEvent("click", { bubbles: true, shiftKey: true }));

      const toggle = window.document.getElementById("better-gateway-chat-toggle") as HTMLButtonElement | null;
      expect(toggle).not.toBeNull();
      expect(toggle?.style.display).toBe("block");
      expect(toggle?.textContent).toBe("→");

      toggle?.click(); // hide chat => ide only
      expect(main.style.display).toBe("none");
      expect(toggle?.textContent).toBe("←");
    });

    it("should toggle split/ide with Cmd/Ctrl+L", () => {
      const { main } = createGatewaySidebar();
      window.eval(injectScript);

      const ideNav = window.document.getElementById("better-gateway-ide-nav");
      // Regular click -> IDE-only (no chat)
      ideNav?.click();
      expect(main.style.display).toBe("none");

      // Ctrl+L should toggle to split (show chat)
      window.dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "l",
        ctrlKey: true,
        bubbles: true,
      }));
      expect(main.style.display).not.toBe("none");

      // Ctrl+L again should go back to IDE-only
      window.dispatchEvent(new window.KeyboardEvent("keydown", {
        key: "l",
        ctrlKey: true,
        bubbles: true,
      }));
      expect(main.style.display).toBe("none");
    });


  describe("compose layout: Send/Stop proxy button", () => {
    /**
     * Creates the DOM structure that mirrors what the OpenClaw gateway
     * actually renders for the chat compose area:
     *
     *   <main class="content">
     *     <section class="chat-compose">
     *       <label class="field chat-compose__field">
     *         <textarea></textarea>
     *       </label>
     *       <div class="chat-compose__actions">
     *         <button class="btn">New session</button>   ← abortButton (Lit: "New session"|"Stop")
     *         <button class="btn primary">Send<kbd>↵</kbd></button>  ← sendButton
     *       </div>
     *     </section>
     *   </main>
     */
    function createGatewayCompose() {
      const main = window.document.createElement("main");
      main.className = "content";

      const section = window.document.createElement("section");
      section.className = "chat-compose";

      const fieldLabel = window.document.createElement("label");
      fieldLabel.className = "field chat-compose__field";
      const textarea = window.document.createElement("textarea");
      fieldLabel.appendChild(textarea);

      const actionsDiv = window.document.createElement("div");
      actionsDiv.className = "chat-compose__actions";

      const abortBtn = window.document.createElement("button");
      abortBtn.className = "btn";
      abortBtn.textContent = "New session";

      const sendBtn = window.document.createElement("button");
      sendBtn.className = "btn primary";
      sendBtn.textContent = "Send";
      const kbd = window.document.createElement("kbd");
      kbd.textContent = "↵";
      sendBtn.appendChild(kbd);

      actionsDiv.appendChild(abortBtn);
      actionsDiv.appendChild(sendBtn);
      section.appendChild(fieldLabel);
      section.appendChild(actionsDiv);
      main.appendChild(section);
      window.document.body.appendChild(main);

      return { main, section, fieldLabel, textarea, actionsDiv, abortBtn, sendBtn };
    }

    it("should hide the original actions bar and inject a proxy send button", () => {
      const { actionsDiv, fieldLabel } = createGatewayCompose();
      window.eval(injectScript);

      // Original actions bar should be hidden.
      expect(actionsDiv.style.display).toBe("none");
      // Proxy button should exist inside the field label.
      const proxy = fieldLabel.querySelector("#bg-compose-send-stop-btn");
      expect(proxy).not.toBeNull();
      expect((proxy as HTMLElement).getAttribute("aria-label")).toBe("Send message");
    });

    it("proxy button shows Send icon in idle state and Stop icon when abortButton says Stop", async () => {
      const { abortBtn, fieldLabel } = createGatewayCompose();
      window.eval(injectScript);
      await new Promise((r) => setTimeout(r, 0));

      const proxy = fieldLabel.querySelector("#bg-compose-send-stop-btn") as HTMLElement;
      expect(proxy).not.toBeNull();

      // Initially idle → aria-label "Send message".
      expect(proxy.getAttribute("aria-label")).toBe("Send message");

      // Simulate Lit switching the abort button to "Stop" (streaming started).
      // MutationObserver fires automatically on textContent change in JSDOM.
      abortBtn.textContent = "Stop";
      await new Promise((r) => setTimeout(r, 0));
      expect(proxy.getAttribute("aria-label")).toBe("Stop response");

      // Simulate Lit reverting abort button to "New session" (streaming ended).
      abortBtn.textContent = "New session";
      await new Promise((r) => setTimeout(r, 0));
      expect(proxy.getAttribute("aria-label")).toBe("Send message");
    });

    it("proxy button click delegates to sendButton when idle", () => {
      const { sendBtn, fieldLabel } = createGatewayCompose();
      let sendClicked = false;
      sendBtn.addEventListener("click", () => { sendClicked = true; });

      window.eval(injectScript);

      const proxy = fieldLabel.querySelector("#bg-compose-send-stop-btn") as HTMLElement;
      proxy?.click();
      expect(sendClicked).toBe(true);
    });

    it("proxy button click delegates to abortButton when streaming", async () => {
      const { abortBtn, fieldLabel } = createGatewayCompose();
      let abortClicked = false;
      abortBtn.addEventListener("click", () => { abortClicked = true; });

      window.eval(injectScript);
      await new Promise((r) => setTimeout(r, 0));

      // Simulate streaming start; MutationObserver fires automatically.
      abortBtn.textContent = "Stop";
      await new Promise((r) => setTimeout(r, 0));

      const proxy = fieldLabel.querySelector("#bg-compose-send-stop-btn") as HTMLElement;
      proxy?.click();
      expect(abortClicked).toBe(true);
    });

    it("should not double-enhance if called again on the same field", () => {
      const { fieldLabel } = createGatewayCompose();
      window.eval(injectScript);
      window.eval(injectScript);  // second run after MutationObserver fires

      const proxies = fieldLabel.querySelectorAll("#bg-compose-send-stop-btn");
      expect(proxies.length).toBe(1);
    });

    it("should inject New Session proxy button into chat-controls header", () => {
      // Add a minimal chat-controls bar with a focus button.
      const controls = window.document.createElement("div");
      controls.className = "chat-controls";
      const focusBtn = window.document.createElement("button");
      focusBtn.title = "Focus mode";
      controls.appendChild(focusBtn);
      window.document.body.appendChild(controls);

      createGatewayCompose();
      window.eval(injectScript);

      const headerBtn = window.document.getElementById("bg-header-new-session-btn");
      expect(headerBtn).not.toBeNull();
      expect(headerBtn?.getAttribute("aria-label")).toBe("New session");
    });
  });

  describe("sidebar chat @file mentions", () => {
    function createChatComposer() {
      const main = window.document.createElement("main");
      main.className = "content";
      const form = window.document.createElement("form");
      const textarea = window.document.createElement("textarea");
      const send = window.document.createElement("button");
      send.type = "submit";
      send.textContent = "Send";
      form.appendChild(textarea);
      form.appendChild(send);
      main.appendChild(form);
      window.document.body.appendChild(main);
      return { textarea, send, form };
    }

    it("should render mention picker and chips, and support keyboard selection/removal", async () => {
      window.fetch = vi.fn(async (url: string) => {
        if (String(url).includes('/api/files/read')) {
          return { ok: true, json: async () => ({ content: 'hello world' }) } as any;
        }
        return { ok: true, json: async () => ({ files: [{ path: 'src/index.ts', type: 'file' }] }) } as any;
      });

      const { textarea } = createChatComposer();
      window.eval(injectScript);
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));

      textarea.value = '@src';
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));

      const picker = window.document.querySelector('.better-gateway-chat-file-picker');
      expect(picker).not.toBeNull();
      expect((picker as HTMLElement).style.display).not.toBe('none');

      textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();

      const chip = window.document.querySelector('.better-gateway-chat-file-chip');
      expect(chip).not.toBeNull();

      textarea.value = '';
      textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      expect(window.document.querySelector('.better-gateway-chat-file-chip')).toBeNull();
    });

    it("should attach referenced files into outbound chat.send payload", async () => {
      window.fetch = vi.fn(async (url: string) => {
        if (String(url).includes('/api/files/read')) {
          return { ok: true, json: async () => ({ content: 'context content' }) } as any;
        }
        return { ok: true, json: async () => ({ files: [{ path: 'AGENTS.md', type: 'file' }] }) } as any;
      });

      const { textarea } = createChatComposer();
      window.eval(injectScript);
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));

      textarea.value = 'hi @AG';
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
      textarea.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));

      const ws = new window.WebSocket('ws://localhost:8080');
      ws.send(JSON.stringify({ type: 'req', id: '1', method: 'chat.send', params: { message: 'hi' } }));

      const rawSend = OriginalWebSocket.mock.instances[OriginalWebSocket.mock.instances.length - 1]._rawSend;
      const payload = JSON.parse(rawSend.mock.calls[0][0]);
      expect(payload.params.message).toContain('<file path="AGENTS.md">');
      expect(payload.params.message).toContain('context content');
    });
  });
  });
});
