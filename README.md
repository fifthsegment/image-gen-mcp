# image-gen-mcp

MCP server for generating images via Replicate API. Supports Imagen 3, Flux, and nano-banana-pro models. All images auto-compress to JPG.

## Requirements

- Node.js 18+
- Replicate API token (https://replicate.com/account/api-tokens)

## Install

```bash
npm install
npm run build
```

## Configuration

```bash
export REPLICATE_API_TOKEN="your-token"
export IMAGE_OUTPUT_DIR="/optional/custom/path"  # defaults to ./generated-images
```

## MCP Client Setup

```json
{
  "mcpServers": {
    "image-gen": {
      "command": "node",
      "args": ["/path/to/image-gen-mcp/dist/index.js"],
      "env": {
        "REPLICATE_API_TOKEN": "your-token"
      }
    }
  }
}
```

## Models

| Model | Cost | Reference Images | Notes |
|-------|------|------------------|-------|
| imagen-3 | $0.04 | No | Default, high quality |
| imagen-3-fast | $0.02 | No | Faster |
| nano-banana-pro | $0.05 | Yes | Best text rendering |
| flux-schnell | $0.003 | No | Cheapest |
| flux-dev | $0.025 | No | Better quality |
| flux-pro | $0.04 | No | Professional |
| flux-redux | $0.025 | Yes | Style transfer |

## Tools

### generate_image

Generate an image from text prompt.

Parameters:
- `prompt` (required) - description of what to generate
- `model` - model key from table above, default: imagen-3
- `reference_image` - local path for style reference (flux-redux, nano-banana-pro only)
- `aspect_ratio` - 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, 9:21
- `compression_quality` - 1-100, default: 85
- `num_outputs` - 1-4, default: 1
- `prompt_strength` - 0.0-1.0 for reference images, default: 0.8

### compress_image

Compress existing image to JPG.

Parameters:
- `input_path` (required)
- `output_path` - default: adds _compressed.jpg suffix
- `quality` - 1-100, default: 85
- `max_width`, `max_height` - resize limits in pixels

### get_image_info

Returns dimensions, format, file size for an image path.

### list_models

Returns available models with pricing.

### list_generated_images

Lists images in output directory.

### get_output_directory

Returns configured output path.

## Testing

```bash
npm test
npm run test:coverage
```

## License

MIT
