import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { IncomingMessage, ServerResponse } from "node:http";
import { createFileApiHandler, DEFAULT_MAX_FILE_SIZE } from "./file-api.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";

// Create a real temp directory for testing
let testWorkspace: string;
let handler: ReturnType<typeof createFileApiHandler>;

describe("File API", () => {
  beforeEach(async () => {
    // Create temp workspace with test files
    testWorkspace = path.join(tmpdir(), `file-api-test-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });
    await fs.mkdir(path.join(testWorkspace, "subdir"), { recursive: true });
    await fs.writeFile(path.join(testWorkspace, "test.txt"), "Hello World");
    await fs.writeFile(path.join(testWorkspace, "test.md"), "# Markdown");
    await fs.writeFile(path.join(testWorkspace, "subdir", "nested.txt"), "Nested file");
    
    handler = createFileApiHandler({
      workspaceDir: testWorkspace,
      maxFileSize: DEFAULT_MAX_FILE_SIZE,
    });
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  function createMockReq(
    method: string,
    pathname: string,
    query: Record<string, string> = {},
    body?: Record<string, unknown>
  ): IncomingMessage {
    const queryString = new URLSearchParams(query).toString();
    const url = queryString ? `${pathname}?${queryString}` : pathname;
    
    const req = {
      url,
      method,
      headers: { host: "localhost:18789" },
      on: vi.fn((event: string, cb: (data?: Buffer) => void) => {
        if (event === "data" && body) {
          cb(Buffer.from(JSON.stringify(body)));
        }
        if (event === "end") {
          cb();
        }
      }),
    } as unknown as IncomingMessage;
    
    return req;
  }

  function createMockRes(): ServerResponse & { 
    _statusCode: number; 
    _headers: Record<string, string | number>;
    _body: string;
  } {
    const res = {
      _statusCode: 0,
      _headers: {},
      _body: "",
      writeHead: vi.fn(function(this: any, status: number, headers: Record<string, string | number>) {
        this._statusCode = status;
        this._headers = headers;
      }),
      setHeader: vi.fn(function(this: any, name: string, value: string) {
        this._headers[name] = value;
      }),
      end: vi.fn(function(this: any, body: string) {
        this._body = body;
      }),
    } as unknown as ServerResponse & { 
      _statusCode: number; 
      _headers: Record<string, string | number>;
      _body: string;
    };
    
    return res;
  }

  describe("GET /api/files (list directory)", () => {
    it("should list files in workspace root", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files", { path: "." });
      const res = createMockRes();
      
      const handled = await handler(req, res, "/better-gateway/api/files");
      
      expect(handled).toBe(true);
      expect(res._statusCode).toBe(200);
      
      const body = JSON.parse(res._body);
      expect(body.files).toBeDefined();
      expect(body.files.length).toBeGreaterThan(0);
      
      const fileNames = body.files.map((f: { name: string }) => f.name);
      expect(fileNames).toContain("test.txt");
      expect(fileNames).toContain("test.md");
      expect(fileNames).toContain("subdir");
    });

    it("should list files in subdirectory", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files", { path: "subdir" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files");
      
      const body = JSON.parse(res._body);
      expect(body.files.length).toBe(1);
      expect(body.files[0].name).toBe("nested.txt");
    });

    it("should handle path=/ as workspace root", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files", { path: "/" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files");
      
      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.files.length).toBeGreaterThan(0);
    });

    it("should accept workspace/ prefixed paths", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files", { path: "workspace/subdir" });
      const res = createMockRes();

      await handler(req, res, "/better-gateway/api/files");

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.files.length).toBe(1);
      expect(body.files[0].path).toBe("subdir/nested.txt");
    });

    it("should accept absolute paths inside workspace", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files", {
        path: path.join(testWorkspace, "subdir"),
      });
      const res = createMockRes();

      await handler(req, res, "/better-gateway/api/files");

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.files.length).toBe(1);
      expect(body.files[0].path).toBe("subdir/nested.txt");
    });

    it("should reject path traversal attempts", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files", { path: "../../../etc" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files");
      
      expect(res._statusCode).toBe(403);
      const body = JSON.parse(res._body);
      expect(body.error).toContain("outside workspace");
    });

    it("should return 404 for non-existent directory", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files", { path: "nonexistent" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files");
      
      expect(res._statusCode).toBe(404);
    });
  });

  describe("GET /api/files/read", () => {
    it("should read file content", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files/read", { path: "test.txt" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/read");
      
      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.content).toBe("Hello World");
      expect(body.path).toBe("test.txt");
      expect(body.size).toBe(11);
    });

    it("should read nested file", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files/read", { path: "subdir/nested.txt" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/read");
      
      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.content).toBe("Nested file");
    });

    it("should read file with workspace/ prefix and normalize response path", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files/read", { path: "workspace/test.txt" });
      const res = createMockRes();

      await handler(req, res, "/better-gateway/api/files/read");

      expect(res._statusCode).toBe(200);
      const body = JSON.parse(res._body);
      expect(body.content).toBe("Hello World");
      expect(body.path).toBe("test.txt");
    });

    it("should return 400 for missing path", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files/read", {});
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/read");
      
      expect(res._statusCode).toBe(400);
    });

    it("should return 404 for non-existent file", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files/read", { path: "nonexistent.txt" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/read");
      
      expect(res._statusCode).toBe(404);
    });

    it("should reject path traversal", async () => {
      const req = createMockReq("GET", "/better-gateway/api/files/read", { path: "../../etc/passwd" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/read");
      
      expect(res._statusCode).toBe(403);
    });
  });

  describe("POST /api/files/write", () => {
    it("should write new file", async () => {
      const req = createMockReq("POST", "/better-gateway/api/files/write", {}, {
        path: "newfile.txt",
        content: "New content",
      });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/write");
      
      expect(res._statusCode).toBe(200);
      
      // Verify file was created
      const content = await fs.readFile(path.join(testWorkspace, "newfile.txt"), "utf-8");
      expect(content).toBe("New content");
    });

    it("should overwrite existing file", async () => {
      const req = createMockReq("POST", "/better-gateway/api/files/write", {}, {
        path: "test.txt",
        content: "Updated content",
      });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/write");
      
      expect(res._statusCode).toBe(200);
      
      const content = await fs.readFile(path.join(testWorkspace, "test.txt"), "utf-8");
      expect(content).toBe("Updated content");
    });

    it("should create nested directories", async () => {
      const req = createMockReq("POST", "/better-gateway/api/files/write", {}, {
        path: "new/nested/dir/file.txt",
        content: "Deep nested",
      });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/write");
      
      expect(res._statusCode).toBe(200);
      
      const content = await fs.readFile(path.join(testWorkspace, "new/nested/dir/file.txt"), "utf-8");
      expect(content).toBe("Deep nested");
    });

    it("should return 400 for missing path", async () => {
      const req = createMockReq("POST", "/better-gateway/api/files/write", {}, {
        content: "No path",
      });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/write");
      
      expect(res._statusCode).toBe(400);
    });

    it("should reject path traversal", async () => {
      const req = createMockReq("POST", "/better-gateway/api/files/write", {}, {
        path: "../../../tmp/evil.txt",
        content: "Evil content",
      });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/write");
      
      expect(res._statusCode).toBe(403);
    });
  });

  describe("DELETE /api/files", () => {
    it("should delete file", async () => {
      const req = createMockReq("DELETE", "/better-gateway/api/files", { path: "test.txt" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files");
      
      expect(res._statusCode).toBe(200);
      
      // Verify file was deleted
      await expect(fs.access(path.join(testWorkspace, "test.txt"))).rejects.toThrow();
    });

    it("should return 400 for missing path", async () => {
      const req = createMockReq("DELETE", "/better-gateway/api/files", {});
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files");
      
      expect(res._statusCode).toBe(400);
    });

    it("should return 404 for non-existent file", async () => {
      const req = createMockReq("DELETE", "/better-gateway/api/files", { path: "nonexistent.txt" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files");
      
      expect(res._statusCode).toBe(404);
    });

    it("should reject path traversal", async () => {
      const req = createMockReq("DELETE", "/better-gateway/api/files", { path: "../../important.txt" });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files");
      
      expect(res._statusCode).toBe(403);
    });
  });

  describe("POST /api/files/mkdir", () => {
    it("should create directory", async () => {
      const req = createMockReq("POST", "/better-gateway/api/files/mkdir", {}, {
        path: "newdir",
      });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/mkdir");
      
      expect(res._statusCode).toBe(200);
      
      const stat = await fs.stat(path.join(testWorkspace, "newdir"));
      expect(stat.isDirectory()).toBe(true);
    });

    it("should create nested directories", async () => {
      const req = createMockReq("POST", "/better-gateway/api/files/mkdir", {}, {
        path: "deep/nested/dir",
      });
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files/mkdir");
      
      expect(res._statusCode).toBe(200);
      
      const stat = await fs.stat(path.join(testWorkspace, "deep/nested/dir"));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe("CORS headers", () => {
    it("should handle OPTIONS preflight", async () => {
      const req = createMockReq("OPTIONS", "/better-gateway/api/files", {});
      const res = createMockRes();
      
      await handler(req, res, "/better-gateway/api/files");
      
      expect(res._statusCode).toBe(204);
      // CORS headers set via setHeader, verified by preflight working
    });
  });

  describe("Unhandled routes", () => {
    it("should return false for non-file-api routes", async () => {
      const req = createMockReq("GET", "/better-gateway/other", {});
      const res = createMockRes();
      
      const handled = await handler(req, res, "/better-gateway/other");
      
      expect(handled).toBe(false);
    });
  });
});
