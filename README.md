# Image Generation MCP Server

An MCP (Model Context Protocol) server for generating images using the Replicate API. Supports Google (Imagen 3, nano-banana-pro) and Flux models. All models are accessed via Replicate. All images are automatically compressed and saved as JPG.

## Features

- **Multiple Models**: Google (Imagen 3, nano-banana-pro) and Flux models
- **Auto Compression**: All generated images are compressed as JPG
- **Reference Images**: Supported by flux-redux and nano-banana-pro
- **Prompt-based Filenames**: Images are named based on prompt content
- **Local Storage**: Downloads and compresses images locally

## Requirements

- Node.js 18+
- Replicate API token

## Installation

```bash
npm install
npm run build
```

## Configuration

Set your Replicate API token:

```bash
export REPLICATE_API_TOKEN="your-api-token-here"
```

Get your API token from: https://replicate.com/account/api-tokens

Optionally, set a custom output directory:

```bash
export IMAGE_OUTPUT_DIR="/path/to/your/output/directory"
```

## MCP Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "image-gen": {
      "command": "node",
      "args": ["/path/to/image-gen-mcp/dist/index.js"],
      "env": {
        "REPLICATE_API_TOKEN": "your-api-token-here",
        "IMAGE_OUTPUT_DIR": "/path/to/output/directory"
      }
    }
  }
}
```

## Available Models

| Model | Provider | Cost | Reference Images | Best For |
|-------|----------|------|------------------|----------|
| `imagen-3` | Google | $0.04 | No | High quality (default) |
| `imagen-3-fast` | Google | $0.02 | No | Fast generation |
| `nano-banana-pro` | Google | $0.05 | Yes | Text rendering, reference images |
| `flux-schnell` | Replicate | $0.003 | No | Cheapest, fast iterations |
| `flux-dev` | Replicate | $0.025 | No | Higher quality |
| `flux-pro` | Replicate | $0.04 | No | Professional quality |
| `flux-redux` | Replicate | $0.025 | Yes | Style transfer |

## Tools

### `generate_image`

Generate an image. Auto-compresses and saves as JPG.

**Parameters:**
- `prompt` (required): Text description
- `model` (optional): Model to use. Default: `imagen-3`
- `reference_image` (optional): Path to reference image (flux-redux or nano-banana-pro only)
- `aspect_ratio` (optional): "1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "9:21". Default: "1:1"
- `compression_quality` (optional): 1-100. Default: 85
- `num_outputs` (optional): 1-4. Default: 1
- `prompt_strength` (optional): 0.0-1.0 for reference images. Default: 0.8

### `compress_image`

Compress an existing image to JPG.

**Parameters:**
- `input_path` (required): Path to image
- `output_path` (optional): Output path. Default: adds `_compressed.jpg`
- `quality` (optional): 1-100. Default: 85
- `max_width` (optional): Max width in pixels
- `max_height` (optional): Max height in pixels

### `get_image_info`

Get image metadata (dimensions, format, size).

### `list_models`

List all available models with costs.

### `list_generated_images`

List generated images in output directory.

### `get_output_directory`

Get the output directory path.

## Examples

**Simple image (uses imagen-3 by default):**
```
Generate an image of a mountain landscape
```

**Cheapest option:**
```
Generate an image of a cat using flux-schnell
```

**Best for text:**
```
Generate a poster with "Welcome" text using nano-banana-pro
```

**With reference image:**
```
Generate an image similar to /path/to/style.jpg using flux-redux
```

## License

MIT
