# python/scripts/audio_processor.py
import yt_dlp
import sys
import json
import shutil

from bpm_analyzer import analyze_bpm
from key_analyzer import analyze_key

def download_audio(url):
    ydl_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': 'downloads/%(title)s.%(ext)s',
    }
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        ydl_opts['ffmpeg_location'] = ffmpeg_path
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info_dict = ydl.extract_info(url, download=True)
        audio_file = ydl.prepare_filename(info_dict).replace('.webm', '.mp3')
    return audio_file

def analyze_audio(file_path):
    return analyze_bpm(file_path), analyze_key(file_path)

def process_audio(url):
    # Your audio processing logic here
    audio_file = download_audio(url)
    tempo, key = analyze_audio(audio_file)
    result = {
        'tempo': tempo,
        'key': key,
    }
    return result

if __name__ == "__main__":
    url = sys.argv[1]
    result = process_audio(url)
    
    print(json.dumps(result))
