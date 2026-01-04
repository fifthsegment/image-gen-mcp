import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { createServer, handleToolCall, tools, MODELS, DEFAULT_MODEL, OUTPUT_DIR } from "../src/index.js";
import { connectTestClient, TestClient } from "./test-transport.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

describe("Image Gen MCP Server", () => {
  let server: Server;
  let client: TestClient;

  beforeAll(async () => {
    process.env.REPLICATE_API_TOKEN = "test-token";
    
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
  });

  beforeEach(async () => {
    server = createServer();
    client = await connectTestClient(server);
  });

  afterEach(async () => {
    await client.close();
  });

  describe("listTools", () => {
    it("returns all expected tools", async () => {
      const result = await client.listTools();
      
      expect(result.tools).toHaveLength(6);
      
      const toolNames = result.tools.map(t => t.name);
      expect(toolNames).toContain("generate_image");
      expect(toolNames).toContain("compress_image");
      expect(toolNames).toContain("get_image_info");
      expect(toolNames).toContain("list_models");
      expect(toolNames).toContain("list_generated_images");
      expect(toolNames).toContain("get_output_directory");
    });

    it("generate_image tool has correct input schema", async () => {
      const result = await client.listTools();
      const generateTool = result.tools.find(t => t.name === "generate_image");
      
      expect(generateTool).toBeDefined();
      expect(generateTool!.inputSchema.required).toContain("prompt");
      expect(generateTool!.inputSchema.properties).toHaveProperty("prompt");
      expect(generateTool!.inputSchema.properties).toHaveProperty("model");
      expect(generateTool!.inputSchema.properties).toHaveProperty("aspect_ratio");
    });
  });

  describe("list_models", () => {
    it("returns all available models with correct structure", async () => {
      const result = await client.callTool("list_models");
      const data = JSON.parse(result.content[0].text);
      
      expect(data.default_model).toBe(DEFAULT_MODEL);
      expect(data.models).toBeInstanceOf(Array);
      expect(data.models.length).toBe(Object.keys(MODELS).length);
      
      const modelKeys = data.models.map((m: { key: string }) => m.key);
      expect(modelKeys).toContain("imagen-3");
      expect(modelKeys).toContain("flux-schnell");
      expect(modelKeys).toContain("nano-banana-pro");
    });

    it("each model has required properties", async () => {
      const result = await client.callTool("list_models");
      const data = JSON.parse(result.content[0].text);
      
      for (const model of data.models) {
        expect(model).toHaveProperty("key");
        expect(model).toHaveProperty("name");
        expect(model).toHaveProperty("provider");
        expect(model).toHaveProperty("cost");
        expect(model).toHaveProperty("supports_reference_image");
        expect(model).toHaveProperty("description");
      }
    });

    it("identifies models supporting reference images correctly", async () => {
      const result = await client.callTool("list_models");
      const data = JSON.parse(result.content[0].text);
      
      const fluxRedux = data.models.find((m: { key: string }) => m.key === "flux-redux");
      const nanoBanana = data.models.find((m: { key: string }) => m.key === "nano-banana-pro");
      const imagen3 = data.models.find((m: { key: string }) => m.key === "imagen-3");
      
      expect(fluxRedux.supports_reference_image).toBe(true);
      expect(nanoBanana.supports_reference_image).toBe(true);
      expect(imagen3.supports_reference_image).toBe(false);
    });
  });

  describe("get_output_directory", () => {
    it("returns the configured output directory", async () => {
      const result = await client.callTool("get_output_directory");
      const data = JSON.parse(result.content[0].text);
      
      expect(data.output_directory).toBe(OUTPUT_DIR);
      expect(data.exists).toBe(true);
    });
  });

  describe("list_generated_images", () => {
    it("returns output directory info", async () => {
      const result = await client.callTool("list_generated_images");
      const data = JSON.parse(result.content[0].text);
      
      expect(data.output_directory).toBe(OUTPUT_DIR);
      expect(data.images).toBeInstanceOf(Array);
    });

    it("returns images when they exist in the directory", async () => {
      const testImagePath = path.join(OUTPUT_DIR, "test-image-for-list.jpg");
      fs.writeFileSync(testImagePath, Buffer.alloc(100));
      
      try {
        const result = await client.callTool("list_generated_images");
        const data = JSON.parse(result.content[0].text);
        
        expect(data.images.length).toBeGreaterThanOrEqual(1);
        const testImage = data.images.find((img: { filename: string }) => img.filename === "test-image-for-list.jpg");
        expect(testImage).toBeDefined();
        expect(testImage.path).toBe(testImagePath);
      } finally {
        if (fs.existsSync(testImagePath)) {
          fs.unlinkSync(testImagePath);
        }
      }
    });
  });
});

describe("handleToolCall - Direct Tool Tests", () => {
  beforeAll(() => {
    process.env.REPLICATE_API_TOKEN = "test-token";
  });

  describe("get_image_info", () => {
    it("returns error for non-existent image", async () => {
      const result = await handleToolCall("get_image_info", {
        image_path: "/nonexistent/path/image.jpg",
      });
      
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("not found");
    });
  });

  describe("compress_image", () => {
    it("returns error for non-existent input image", async () => {
      const result = await handleToolCall("compress_image", {
        input_path: "/nonexistent/input.jpg",
      });
      
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("not found");
    });
  });

  describe("generate_image", () => {
    it("returns error for unknown model", async () => {
      const result = await handleToolCall("generate_image", {
        prompt: "test prompt",
        model: "unknown-model",
      });
      
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Unknown model");
    });

    it("returns error when reference image used with unsupported model", async () => {
      const result = await handleToolCall("generate_image", {
        prompt: "test prompt",
        model: "imagen-3",
        reference_image: "/some/image.jpg",
      });
      
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("does not support reference images");
    });
  });

  describe("unknown_tool", () => {
    it("returns error for unknown tool", async () => {
      const result = await handleToolCall("unknown_tool", {});
      
      expect(result.isError).toBe(true);
      const data = JSON.parse(result.content[0].text);
      expect(data.success).toBe(false);
      expect(data.error).toContain("Unknown tool");
    });
  });
});

describe("MODELS Configuration", () => {
  it("all models have required configuration", () => {
    for (const [key, config] of Object.entries(MODELS)) {
      expect(config).toHaveProperty("id");
      expect(config).toHaveProperty("name");
      expect(config).toHaveProperty("provider");
      expect(config).toHaveProperty("supportsReferenceImage");
      expect(config).toHaveProperty("cost");
      expect(config).toHaveProperty("description");
      expect(config.provider).toBe("replicate");
    }
  });

  it("DEFAULT_MODEL exists in MODELS", () => {
    expect(MODELS[DEFAULT_MODEL]).toBeDefined();
  });

  it("tools array has correct tool count", () => {
    expect(tools).toHaveLength(6);
  });
});

describe("Image Processing Tests", () => {
  const testDir = path.join(process.cwd(), "test-image-processing");
  
  beforeAll(async () => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(testDir)) {
      const files = fs.readdirSync(testDir);
      for (const file of files) {
        fs.unlinkSync(path.join(testDir, file));
      }
      fs.rmdirSync(testDir);
    }
  });

  it("get_image_info works with valid PNG image", async () => {
    const { createCanvas } = await import("canvas").catch(() => null) || {};
    if (!createCanvas) {
      const sharp = (await import("sharp")).default;
      const testImagePath = path.join(testDir, "test-valid.png");
      await sharp({
        create: {
          width: 100,
          height: 100,
          channels: 3,
          background: { r: 255, g: 0, b: 0 }
        }
      }).png().toFile(testImagePath);

      const result = await handleToolCall("get_image_info", {
        image_path: testImagePath,
      });
      
      expect(result.isError).toBeFalsy();
      const data = JSON.parse(result.content[0].text);
      expect(data.width).toBe(100);
      expect(data.height).toBe(100);
      expect(data.format).toBe("png");
    }
  });

  it("compress_image compresses valid image", async () => {
    const sharp = (await import("sharp")).default;
    const inputPath = path.join(testDir, "to-compress.png");
    const outputPath = path.join(testDir, "compressed.jpg");
    
    await sharp({
      create: {
        width: 200,
        height: 200,
        channels: 3,
        background: { r: 128, g: 128, b: 128 }
      }
    }).png().toFile(inputPath);

    const result = await handleToolCall("compress_image", {
      input_path: inputPath,
      output_path: outputPath,
      quality: 80,
    });
    
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    expect(data.output_path).toBe(outputPath);
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it("compress_image with resize options", async () => {
    const sharp = (await import("sharp")).default;
    const inputPath = path.join(testDir, "large-image.png");
    const outputPath = path.join(testDir, "resized.jpg");
    
    await sharp({
      create: {
        width: 1000,
        height: 1000,
        channels: 3,
        background: { r: 0, g: 255, b: 0 }
      }
    }).png().toFile(inputPath);

    const result = await handleToolCall("compress_image", {
      input_path: inputPath,
      output_path: outputPath,
      quality: 85,
      max_width: 500,
      max_height: 500,
    });
    
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.success).toBe(true);
    
    const metadata = await sharp(outputPath).metadata();
    expect(metadata.width).toBeLessThanOrEqual(500);
    expect(metadata.height).toBeLessThanOrEqual(500);
  });
});
