from flask import Flask, request, render_template, Response, stream_with_context
import whisper
import os
import uuid
import subprocess
import shutil
import json
import time
import threading
from deep_translator import GoogleTranslator
import yt_dlp
import librosa

app = Flask(__name__)

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

models = {}

def get_model(name):
    if name not in models:
        models[name] = whisper.load_model(name)
    return models[name]

@app.route("/")
def home():
    return render_template("index.html")

def sse(data):
    return "data: " + json.dumps(data, default=str) + "\n\n"

def detect_music(path):
    try:
        y, sr = librosa.load(path, duration=10)
        return float((y**2).mean()) > 0.005
    except:
        return False

@app.route("/transcribe-stream", methods=["POST"])
def transcribe_stream():

    file = request.files.get("file")
    url = request.form.get("url")
    language = request.form.get("language", "")
    quality = request.form.get("quality", "base")

    # 🔥 CRITICAL FIX: HANDLE FILE BEFORE GENERATOR
    path = None
    title = "File"

    if url:
        unique_id = str(uuid.uuid4())
        filename = os.path.join(UPLOAD_FOLDER, f"{unique_id}.%(ext)s")

        with yt_dlp.YoutubeDL({
            "format": "bestaudio/best",
            "outtmpl": filename,
            "quiet": True
        }) as ydl:
            info = ydl.extract_info(url, download=True)
            path = ydl.prepare_filename(info)
            title = str(info.get("title", url))

    else:
        # 🔥 fully detach from Flask request
        data = file.read()

        filename = f"{uuid.uuid4()}_{file.filename}"
        path = os.path.join(UPLOAD_FOLDER, filename)

        with open(path, "wb") as f:
            f.write(data)

        title = file.filename

    def generate():
        try:
            # ================= ANALYZE =================
            duration = float(librosa.get_duration(path=path))

            yield sse({
                "stage": "analyzing",
                "title": title,
                "duration": duration
            })

            # ================= TRANSCRIBE =================
            yield sse({"stage": "transcribing", "seconds": 0})

            model = get_model(quality)

            result_container = {"done": False, "result": None}

            def run():
                result_container["result"] = model.transcribe(path)
                result_container["done"] = True

            t = threading.Thread(target=run)
            t.start()

            sec = 0
            while not result_container["done"]:
                time.sleep(1)
                sec += 1
                yield sse({
                    "stage": "transcribing",
                    "seconds": sec
                })

            result = result_container["result"]

            text = result["text"]
            detected = result.get("language", "")

            # ================= TRANSLATE =================
            if language:
                if language.lower() == "english":
                    text = model.transcribe(path, task="translate")["text"]
                else:
                    try:
                        text = GoogleTranslator(source="auto", target=language).translate(text)
                    except:
                        pass

            yield sse({
                "stage": "done",
                "text": text,
                "detected": detected,
                "title": title
            })

            # CLEANUP
            if path and os.path.exists(path):
                os.remove(path)

        except Exception as e:
            yield sse({
                "stage": "error",
                "error": str(e)
            })

    return Response(stream_with_context(generate()), mimetype="text/event-stream")

import os

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, threaded=True)