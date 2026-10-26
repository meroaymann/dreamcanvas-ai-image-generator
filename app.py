import base64
import os
import random
import time
from urllib.parse import quote

import requests
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder="public/static", static_url_path="/static")

# ---------- Image API ----------
# With a free key (enter.pollinations.ai): new API, no watermark, higher limits.
# Without a key: the old public API still works (watermark, about 1 image every 15 seconds).
API_KEY = os.getenv("POLLINATIONS_API_KEY", "").strip()
IMAGE_API = "https://gen.pollinations.ai/image/" if API_KEY else "https://image.pollinations.ai/prompt/"

MAX_ATTEMPTS = 2        # try again once if the service is busy
REQUEST_TIMEOUT = 45    # seconds to wait for one image
TOTAL_BUDGET = 55       # seconds for all attempts together (keeps us inside hosting time limits)
RETRY_CODES = {500, 502, 503, 504}

# Extra words added to the prompt for each style
STYLES = {
    "none": "",
    "realistic": "photorealistic, highly detailed, natural lighting, 8k",
    "anime": "anime style, vibrant colors, detailed illustration",
    "3d": "3D render, Pixar style, soft lighting, high detail",
    "watercolor": "watercolor painting, soft brush strokes, artistic",
    "cyberpunk": "cyberpunk style, neon lights, futuristic, cinematic",
    "sketch": "pencil sketch, black and white, detailed linework",
}

# Image sizes (width, height)
SIZES = {
    "square": (1024, 1024),
    "landscape": (1280, 720),
    "portrait": (720, 1280),
}


def error(message, status):
    """Send a friendly error message to the page."""
    return jsonify({"error": message}), status


@app.route("/")
def home():
    """Show the main page."""
    return render_template("index.html")


@app.route("/generate", methods=["POST"])
def generate():
    """Receive a prompt, ask the image AI, and return the image."""
    data = request.get_json(silent=True) or {}
    prompt = str(data.get("prompt", "")).strip()
    style = data.get("style", "none")
    size = data.get("size", "square")

    # Validate the input
    if not prompt:
        return error("Please write a prompt first.", 400)
    if len(prompt) > 500:
        return error("Prompt is too long (max 500 characters).", 400)
    if style not in STYLES:
        style = "none"
    if size not in SIZES:
        size = "square"

    # Build the full prompt with the chosen style
    full_prompt = prompt if not STYLES[style] else f"{prompt}, {STYLES[style]}"
    width, height = SIZES[size]

    # The key goes in a header, so it never appears in a URL or a log
    headers = {"Authorization": f"Bearer {API_KEY}"} if API_KEY else {}

    started = time.monotonic()
    last_problem = ""

    for attempt in range(1, MAX_ATTEMPTS + 1):
        time_left = TOTAL_BUDGET - (time.monotonic() - started)
        if time_left < 10:
            break  # not enough time left for another try

        seed = random.randint(1, 999_999)  # a new seed gives a new image every time
        url = (
            f"{IMAGE_API}{quote(full_prompt, safe='')}"  # safe='' also encodes "/" in prompts
            f"?width={width}&height={height}&seed={seed}&nologo=true"
        )

        try:
            response = requests.get(url, headers=headers, timeout=min(REQUEST_TIMEOUT, time_left))
            status = response.status_code
            content_type = response.headers.get("content-type", "")

            # ✅ Success: send the image back as base64
            if status == 200 and content_type.startswith("image/"):
                image_b64 = base64.b64encode(response.content).decode("utf-8")
                return jsonify({
                    "image": f"data:{content_type};base64,{image_b64}",
                    "prompt": prompt,
                    "style": style,
                    "size": size,
                    "seed": seed,
                })

            # ❌ Failed: log what the service said (never shown to the user)
            last_problem = f"{status} {content_type} {response.text[:150]!r}"
            app.logger.warning(f"Attempt {attempt} failed: {last_problem}")

            # Errors where trying again won't help
            if status == 429:
                return error("Too many requests. Please wait about 15 seconds and try again.", 429)
            if status in (401, 403):
                app.logger.error("Image API key is missing, wrong or not allowed for this model.")
                return error("The image service isn't set up correctly. Please try again later.", 503)
            if status == 402:
                return error("The free image limit was reached for now. Please try again later.", 503)
            if status == 400:
                return error("This prompt couldn't be turned into an image. Try different words.", 400)
            if status not in RETRY_CODES:
                break

        except requests.Timeout:
            last_problem = "timeout"
            app.logger.warning(f"Attempt {attempt} timed out")
        except requests.RequestException as e:
            last_problem = str(e)
            app.logger.warning(f"Attempt {attempt} error: {e}")

        # Short pause before trying again
        if attempt < MAX_ATTEMPTS:
            time.sleep(2)

    app.logger.error(f"Image generation failed: {last_problem}")

    if last_problem == "timeout":
        return error("It took too long to create the image. Please try again.", 504)
    return error("The image service is busy right now. Please wait a few seconds and try again.", 502)


if __name__ == "__main__":
    app.run(debug=True)