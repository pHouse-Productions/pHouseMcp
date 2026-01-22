#!/usr/bin/env python3
"""
Image generation script using OpenRouter

Usage:
  generate_image.py "your prompt here" output.png [options]

Arguments:
  prompt                     Text prompt for image generation
  output                     Output file path (e.g., my_image.png)

Options:
  -a, --aspect-ratio RATIO   Aspect ratio (default: 1:1)
                             Options: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
  -s, --size SIZE           Image size (default: 1K)
                             Options: 1K, 2K, 4K
  --pro                     Use Pro model (google/gemini-3-pro-image-preview)
                             Default: google/gemini-2.5-flash-image
  -v, --verbose             Show full API response (including raw JSON)
  -h, --help                Show this help message

Examples:
  generate_image.py "a cat on a skateboard" cat.png
  generate_image.py "sunset" sunset.png -a 16:9 -s 2K
  generate_image.py "landscape" landscape.png --pro
  generate_image.py "test" test.png -v
"""
import sys
import os
import base64
import json
from pathlib import Path
from datetime import datetime
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("OPENROUTER_API_KEY")

# Models
MODEL_FLASH = "google/gemini-2.5-flash-image"
MODEL_PRO = "google/gemini-3-pro-image-preview"

# Defaults
DEFAULT_ASPECT_RATIO = "1:1"
DEFAULT_IMAGE_SIZE = "1K"


def generate_image(prompt: str, output_path: str, aspect_ratio: str = None,
                   image_size: str = None, use_pro: bool = False, verbose: bool = False) -> str:
    if not API_KEY:
        raise ValueError("OPENROUTER_API_KEY must be set in .env file")

    # Use provided values or hardcoded defaults
    aspect_ratio = aspect_ratio or DEFAULT_ASPECT_RATIO
    image_size = image_size or DEFAULT_IMAGE_SIZE
    model = MODEL_PRO if use_pro else MODEL_FLASH

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "modalities": ["image", "text"],
        "image_config": {
            "aspect_ratio": aspect_ratio,
            "image_size": image_size
        },
        "reasoning": {
            "exclude": True
        }
    }

    if verbose:
        print(f"\n=== Request Details ===")
        print(f"Model: {model}")
        print(f"Aspect Ratio: {aspect_ratio}")
        print(f"Image Size: {image_size}")
        print(f"Prompt: {prompt}")
        print(f"\n=== Request Payload ===")
        print(json.dumps(payload, indent=2))
        print("======================\n")
    else:
        print(f"Model: {model}")
        print(f"Aspect Ratio: {aspect_ratio}")
        print(f"Image Size: {image_size}")
        print(f"Generating: {prompt}")

    response = requests.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json=payload,
        timeout=60
    )

    if verbose:
        print(f"\n=== Response Status ===")
        print(f"Status Code: {response.status_code}")
        print(f"Headers: {dict(response.headers)}")
        print("======================\n")

    response.raise_for_status()

    result = response.json()

    if verbose:
        print("\n=== Full API Response ===")
        print(json.dumps(result, indent=2))
        print("=== End Response ===\n")

    message = result["choices"][0]["message"]

    if not message.get("images"):
        raise ValueError("No images in response")

    image_url = message["images"][0]["image_url"]["url"]

    if image_url.startswith("data:image/"):
        _, encoded = image_url.split(",", 1)
        img_bytes = base64.b64decode(encoded)
    elif image_url.startswith("http"):
        img_bytes = requests.get(image_url).content
    else:
        raise ValueError(f"Unknown image format: {image_url[:50]}")

    # Create output filepath
    filepath = Path(output_path)
    filepath.parent.mkdir(parents=True, exist_ok=True)

    filepath.write_bytes(img_bytes)
    return str(filepath)


def print_help():
    print(__doc__)


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] in ["-h", "--help"]:
        print_help()
        sys.exit(0 if len(sys.argv) > 1 else 1)

    if len(sys.argv) < 3:
        print("Error: Both prompt and output path are required", file=sys.stderr)
        print_help()
        sys.exit(1)

    try:
        # First two arguments are prompt and output path
        prompt = sys.argv[1]
        output_path = sys.argv[2]

        # Parse remaining optional arguments
        args = sys.argv[3:]
        aspect_ratio = None
        image_size = None
        use_pro = False
        verbose = False

        i = 0
        while i < len(args):
            arg = args[i]
            if arg in ["-a", "--aspect-ratio"]:
                i += 1
                aspect_ratio = args[i]
            elif arg in ["-s", "--size"]:
                i += 1
                image_size = args[i]
            elif arg == "--pro":
                use_pro = True
            elif arg in ["-v", "--verbose"]:
                verbose = True
            else:
                print(f"Error: Unknown option '{arg}'", file=sys.stderr)
                print_help()
                sys.exit(1)
            i += 1

        output = generate_image(prompt, output_path, aspect_ratio, image_size, use_pro, verbose)
        print(f"✓ Saved to: {output}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
