#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import Replicate from "replicate";
import * as fs from "fs";
import * as path from "path";
import * as https from "https";
import * as http from "http";
import sharp from "sharp";

// Output directory for generated images
const OUTPUT_DIR = process.env.IMAGE_OUTPUT_DIR || path.join(process.cwd(), "generated-images");

// Default compression quality
const DEFAULT_COMPRESSION_QUALITY = 85;

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ============================================================================
// Model Configuration
// ============================================================================

interface ModelConfig {
  id: string;
  name: string;
  provider: "replicate";
  supportsReferenceImage: boolean;
  cost: string;
  description: string;
}

// Available models with pricing (approximate costs per image)
// All models are accessed via Replicate API
const MODELS: Record<string, ModelConfig> = {
  // Google models (via Replicate)
  "imagen-3": {
    id: "google-deepmind/imagen-3.0-generate-001",
    name: "Google Imagen 3",
    provider: "replicate",
    supportsReferenceImage: false,
    cost: "$0.04",
    description: "Google's latest image generation model. High quality.",
  },
  "imagen-3-fast": {
    id: "google-deepmind/imagen-3.0-fast-generate-001",
    name: "Google Imagen 3 Fast",
    provider: "replicate",
    supportsReferenceImage: false,
    cost: "$0.02",
    description: "Faster, cheaper version of Imagen 3.",
  },
  "nano-banana-pro": {
    id: "google-deepmind/nano-banana-pro",
    name: "Nano Banana Pro",
    provider: "replicate",
    supportsReferenceImage: true,
    cost: "$0.05",
    description: "Google's advanced model. Excellent text rendering and reference image support.",
  },
  
  // Flux models (Black Forest Labs via Replicate)
  "flux-schnell": {
    id: "black-forest-labs/flux-schnell",
    name: "Flux Schnell",
    provider: "replicate",
    supportsReferenceImage: false,
    cost: "$0.003",
    description: "Fastest and cheapest. Good for quick iterations.",
  },
  "flux-dev": {
    id: "black-forest-labs/flux-dev",
    name: "Flux Dev",
    provider: "replicate",
    supportsReferenceImage: false,
    cost: "$0.025",
    description: "Higher quality, better details.",
  },
  "flux-pro": {
    id: "black-forest-labs/flux-1.1-pro",
    name: "Flux 1.1 Pro",
    provider: "replicate",
    supportsReferenceImage: false,
    cost: "$0.04",
    description: "Professional quality. Good text rendering.",
  },
  "flux-redux": {
    id: "black-forest-labs/flux-redux-dev",
    name: "Flux Redux",
    provider: "replicate",
    supportsReferenceImage: true,
    cost: "$0.025",
    description: "For image-to-image and style transfer.",
  },
};

// Default model
const DEFAULT_MODEL = "imagen-3";

// ============================================================================
// Image Processing Functions
// ============================================================================

// Initialize Replicate client
function getReplicateClient(): Replicate {
  const apiKey = process.env.REPLICATE_API_TOKEN;
  if (!apiKey) {
    throw new Error(
      "REPLICATE_API_TOKEN environment variable is required. " +
      "Get your API token from https://replicate.com/account/api-tokens"
    );
  }
  return new Replicate({ auth: apiKey });
}

// Download image from URL to local file
async function downloadImage(url: string, filename: string): Promise<string> {
  const outputPath = path.join(OUTPUT_DIR, filename);
  
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    
    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadImage(redirectUrl, filename).then(resolve).catch(reject);
          return;
        }
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: HTTP ${response.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(outputPath);
      response.pipe(fileStream);
      
      fileStream.on("finish", () => {
        fileStream.close();
        resolve(outputPath);
      });
      
      fileStream.on("error", (err) => {
        fs.unlink(outputPath, () => {}); // Clean up partial file
        reject(err);
      });
    });
    
    request.on("error", reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error("Download timeout"));
    });
  });
}

// Convert local file to base64 data URI for Replicate
async function fileToDataUri(filePath: string): Promise<string> {
  const absolutePath = path.resolve(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Reference image not found: ${absolutePath}`);
  }
  
  const buffer = fs.readFileSync(absolutePath);
  const ext = path.extname(filePath).toLowerCase();
  
  let mimeType = "image/png";
  if (ext === ".jpg" || ext === ".jpeg") {
    mimeType = "image/jpeg";
  } else if (ext === ".webp") {
    mimeType = "image/webp";
  } else if (ext === ".gif") {
    mimeType = "image/gif";
  }
  
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Generate a clean filename from a prompt
 */
function generateFilenameFromPrompt(prompt: string, index: number = 0): string {
  const stopWords = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
    "be", "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "need", "it", "its",
    "this", "that", "these", "those", "i", "you", "he", "she", "we", "they",
    "what", "which", "who", "where", "when", "why", "how", "all", "each",
    "every", "both", "few", "more", "most", "other", "some", "such", "no",
    "not", "only", "own", "same", "so", "than", "too", "very", "just", "also",
    "image", "picture", "photo", "generate", "create", "make", "show",
  ]);

  const words = prompt
    .toLowerCase()
    .replace(/["']/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 5);

  if (words.length === 0) {
    words.push("image");
  }

  const slug = words.join("_");
  const timestamp = Date.now();
  const indexSuffix = index > 0 ? `_${index + 1}` : "";
  
  return `${slug}_${timestamp}${indexSuffix}`;
}

// Compress an image using sharp
interface CompressionOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}

async function compressImage(
  inputPath: string,
  outputPath: string,
  options: CompressionOptions = {}
): Promise<{ originalSize: number; compressedSize: number; savedPercent: number }> {
  const {
    quality = DEFAULT_COMPRESSION_QUALITY,
    maxWidth,
    maxHeight,
  } = options;

  const absoluteInput = path.resolve(inputPath);
  const absoluteOutput = path.resolve(outputPath);
  
  if (!fs.existsSync(absoluteInput)) {
    throw new Error(`Input image not found: ${absoluteInput}`);
  }

  const originalStats = fs.statSync(absoluteInput);
  const originalSize = originalStats.size;

  let sharpInstance = sharp(absoluteInput);
  
  if (maxWidth || maxHeight) {
    sharpInstance = sharpInstance.resize(maxWidth, maxHeight, {
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // Always output as JPEG with mozjpeg for best compression
  sharpInstance = sharpInstance.jpeg({ quality, mozjpeg: true });

  await sharpInstance.toFile(absoluteOutput);

  const compressedStats = fs.statSync(absoluteOutput);
  const compressedSize = compressedStats.size;
  const savedPercent = Math.round((1 - compressedSize / originalSize) * 100);

  return {
    originalSize,
    compressedSize,
    savedPercent,
  };
}

// Download and compress image in one step
async function downloadAndCompressImage(
  url: string, 
  filename: string,
  compressionQuality: number = DEFAULT_COMPRESSION_QUALITY
): Promise<{ path: string; originalSize: number; compressedSize: number; savedPercent: number }> {
  // Download to temp file first
  const tempFilename = `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const tempPath = path.join(OUTPUT_DIR, tempFilename);
  const finalPath = path.join(OUTPUT_DIR, filename);
  
  // Download
  await new Promise<void>((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    
    const request = protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          downloadAndCompressImage(redirectUrl, filename, compressionQuality)
            .then(() => resolve())
            .catch(reject);
          return;
        }
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download image: HTTP ${response.statusCode}`));
        return;
      }
      
      const fileStream = fs.createWriteStream(tempPath);
      response.pipe(fileStream);
      
      fileStream.on("finish", () => {
        fileStream.close();
        resolve();
      });
      
      fileStream.on("error", (err) => {
        fs.unlink(tempPath, () => {});
        reject(err);
      });
    });
    
    request.on("error", reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error("Download timeout"));
    });
  });

  // Get original size
  const originalStats = fs.statSync(tempPath);
  const originalSize = originalStats.size;

  // Compress to final path as JPG
  await sharp(tempPath)
    .jpeg({ quality: compressionQuality, mozjpeg: true })
    .toFile(finalPath);

  // Clean up temp file
  fs.unlinkSync(tempPath);

  // Get compressed size
  const compressedStats = fs.statSync(finalPath);
  const compressedSize = compressedStats.size;
  const savedPercent = Math.round((1 - compressedSize / originalSize) * 100);

  return {
    path: finalPath,
    originalSize,
    compressedSize,
    savedPercent,
  };
}

// Get image metadata
async function getImageMetadata(imagePath: string): Promise<{
  width: number;
  height: number;
  format: string;
  size: number;
}> {
  const absolutePath = path.resolve(imagePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Image not found: ${absolutePath}`);
  }

  const metadata = await sharp(absolutePath).metadata();
  const stats = fs.statSync(absolutePath);

  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || "unknown",
    size: stats.size,
  };
}

// ============================================================================
// MCP Tools Definition
// ============================================================================

const modelKeys = Object.keys(MODELS);

const tools: Tool[] = [
  {
    name: "generate_image",
    description: 
      "Generate an image using AI. Images are automatically compressed and saved as JPG.\n\n" +
      "Available models (with cost per image):\n" +
      "- imagen-3: Google Imagen 3 - $0.04 (default)\n" +
      "- imagen-3-fast: Google Imagen 3 Fast - $0.02\n" +
      "- nano-banana-pro: Google's best, text + reference images - $0.05\n" +
      "- flux-schnell: Fastest/cheapest - $0.003\n" +
      "- flux-dev: Higher quality - $0.025\n" +
      "- flux-pro: Professional quality - $0.04\n" +
      "- flux-redux: Reference images/style transfer - $0.025\n\n" +
      "Returns the local file path where the compressed image is saved.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Text description of the image to generate",
        },
        model: {
          type: "string",
          enum: modelKeys,
          description: `Model to use. Default: ${DEFAULT_MODEL}. Use nano-banana-pro for best text rendering or when using reference images.`,
        },
        reference_image: {
          type: "string",
          description: "Local file path to a reference image (only supported by flux-redux and nano-banana-pro)",
        },
        aspect_ratio: {
          type: "string",
          enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21"],
          description: "Aspect ratio for the generated image. Default is 1:1",
        },
        compression_quality: {
          type: "number",
          description: `JPEG compression quality (1-100). Default is ${DEFAULT_COMPRESSION_QUALITY}`,
        },
        num_outputs: {
          type: "number",
          description: "Number of images to generate (1-4). Default is 1",
        },
        prompt_strength: {
          type: "number",
          description: "When using reference image, controls prompt influence (0.0-1.0). Default is 0.8",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "compress_image",
    description: 
      "Compress an existing image to reduce file size. Outputs as JPG.",
    inputSchema: {
      type: "object",
      properties: {
        input_path: {
          type: "string",
          description: "Path to the image file to compress",
        },
        output_path: {
          type: "string",
          description: "Path for the compressed image. Default: adds '_compressed.jpg' suffix",
        },
        quality: {
          type: "number",
          description: `Compression quality (1-100). Default is ${DEFAULT_COMPRESSION_QUALITY}`,
        },
        max_width: {
          type: "number",
          description: "Maximum width in pixels (maintains aspect ratio)",
        },
        max_height: {
          type: "number",
          description: "Maximum height in pixels (maintains aspect ratio)",
        },
      },
      required: ["input_path"],
    },
  },
  {
    name: "get_image_info",
    description: "Get metadata about an image file including dimensions, format, and file size",
    inputSchema: {
      type: "object",
      properties: {
        image_path: {
          type: "string",
          description: "Path to the image file",
        },
      },
      required: ["image_path"],
    },
  },
  {
    name: "list_models",
    description: "List all available image generation models",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "list_generated_images",
    description: "List all previously generated images in the output directory",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_output_directory",
    description: "Get the directory path where generated images are saved",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

// ============================================================================
// MCP Server Setup
// ============================================================================

const server = new Server(
  {
    name: "image-gen-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "generate_image": {
        const {
          prompt,
          model = DEFAULT_MODEL,
          reference_image,
          aspect_ratio = "1:1",
          compression_quality = DEFAULT_COMPRESSION_QUALITY,
          num_outputs = 1,
          prompt_strength = 0.8,
        } = args as {
          prompt: string;
          model?: string;
          reference_image?: string;
          aspect_ratio?: string;
          compression_quality?: number;
          num_outputs?: number;
          prompt_strength?: number;
        };

        // Validate model
        const modelConfig = MODELS[model];
        if (!modelConfig) {
          throw new Error(`Unknown model: ${model}. Available models: ${modelKeys.join(", ")}`);
        }

        // Check reference image support
        if (reference_image && !modelConfig.supportsReferenceImage) {
          throw new Error(
            `Model ${model} does not support reference images. Use flux-redux or nano-banana-pro instead.`
          );
        }

        const replicate = getReplicateClient();
        
        // Build input for the model
        const input: Record<string, unknown> = {
          prompt,
          aspect_ratio,
          num_outputs: Math.min(Math.max(num_outputs, 1), 4),
        };

        // Handle reference image
        if (reference_image && modelConfig.supportsReferenceImage) {
          const imageDataUri = await fileToDataUri(reference_image);
          input.image = imageDataUri;
          input.prompt_strength = prompt_strength;
        }

        // Run the model
        const output = await replicate.run(
          modelConfig.id as `${string}/${string}`,
          { input }
        );

        // Process output - can be string URL or array of URLs
        const urls: string[] = Array.isArray(output) 
          ? output.map(item => typeof item === 'string' ? item : String(item))
          : [typeof output === 'string' ? output : String(output)];

        // Download and compress all generated images
        const results: Array<{
          path: string;
          original_size: string;
          compressed_size: string;
          saved: string;
        }> = [];
        
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];
          const baseFilename = generateFilenameFromPrompt(prompt, i);
          const filename = `${baseFilename}.jpg`;
          
          const result = await downloadAndCompressImage(url, filename, compression_quality);
          results.push({
            path: result.path,
            original_size: `${(result.originalSize / 1024).toFixed(1)} KB`,
            compressed_size: `${(result.compressedSize / 1024).toFixed(1)} KB`,
            saved: `${result.savedPercent}%`,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Generated ${results.length} image(s)`,
                images: results,
                prompt,
                model: {
                  key: model,
                  name: modelConfig.name,
                  provider: modelConfig.provider,
                  cost_per_image: modelConfig.cost,
                },
                settings: {
                  aspect_ratio,
                  compression_quality,
                  had_reference_image: !!reference_image,
                },
              }, null, 2),
            },
          ],
        };
      }

      case "compress_image": {
        const {
          input_path,
          output_path,
          quality = DEFAULT_COMPRESSION_QUALITY,
          max_width,
          max_height,
        } = args as {
          input_path: string;
          output_path?: string;
          quality?: number;
          max_width?: number;
          max_height?: number;
        };

        const finalOutputPath = output_path || (() => {
          const dir = path.dirname(input_path);
          const base = path.basename(input_path, path.extname(input_path));
          return path.join(dir, `${base}_compressed.jpg`);
        })();

        const result = await compressImage(input_path, finalOutputPath, {
          quality,
          maxWidth: max_width,
          maxHeight: max_height,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                input_path,
                output_path: finalOutputPath,
                original_size: `${(result.originalSize / 1024).toFixed(1)} KB`,
                compressed_size: `${(result.compressedSize / 1024).toFixed(1)} KB`,
                saved: `${result.savedPercent}%`,
              }, null, 2),
            },
          ],
        };
      }

      case "get_image_info": {
        const { image_path } = args as { image_path: string };
        
        const metadata = await getImageMetadata(image_path);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                path: path.resolve(image_path),
                width: metadata.width,
                height: metadata.height,
                format: metadata.format,
                size: `${(metadata.size / 1024).toFixed(1)} KB`,
              }, null, 2),
            },
          ],
        };
      }

      case "list_models": {
        const modelList = Object.entries(MODELS).map(([key, config]) => ({
          key,
          name: config.name,
          provider: config.provider,
          cost: config.cost,
          supports_reference_image: config.supportsReferenceImage,
          description: config.description,
        }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                default_model: DEFAULT_MODEL,
                models: modelList,
              }, null, 2),
            },
          ],
        };
      }

      case "list_generated_images": {
        const files = fs.readdirSync(OUTPUT_DIR)
          .filter(f => /\.(png|jpg|jpeg|webp|gif)$/i.test(f))
          .map(f => {
            const fullPath = path.join(OUTPUT_DIR, f);
            const stats = fs.statSync(fullPath);
            return {
              filename: f,
              path: fullPath,
              size: `${(stats.size / 1024).toFixed(1)} KB`,
              created: stats.birthtime.toISOString(),
            };
          })
          .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                output_directory: OUTPUT_DIR,
                image_count: files.length,
                images: files,
              }, null, 2),
            },
          ],
        };
      }

      case "get_output_directory": {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                output_directory: OUTPUT_DIR,
                exists: fs.existsSync(OUTPUT_DIR),
              }, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: false,
            error: errorMessage,
          }, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Image Generation MCP Server running on stdio");
  console.error(`Output directory: ${OUTPUT_DIR}`);
  console.error(`Default model: ${DEFAULT_MODEL}`);
  console.error(`Available models: ${modelKeys.join(", ")}`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
