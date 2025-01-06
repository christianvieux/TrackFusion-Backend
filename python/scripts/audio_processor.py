import yt_dlp
# import librosa
import sys
import json
import logging
import numpy as np  # Add this import
import essentia.standard as es  # Import Essentia's standard module

def download_audio(url):
    ydl_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }],
        'outtmpl': 'downloads/%(title)s.%(ext)s',
        'ffmpeg_location': '/usr/bin/ffmpeg',  # This tells yt-dlp where to find ffmpeg
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info_dict = ydl.extract_info(url, download=True)
        audio_file = ydl.prepare_filename(info_dict).replace('.webm', '.mp3')
    return audio_file

def analyze_audio(file_path):
    # Load the audio with librosa
    # y, sr = librosa.load(file_path)
    # tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    # tempo = float(tempo) if np.isscalar(tempo) else tempo.item() # Ensure that 'tempo' is a scalar, not an ndarray
    audio = es.MonoLoader(filename=file_path)()  # Load audio file
    # Use Essentia for tempo detection
    rhythm_extractor = es.RhythmExtractor()
    tempo, _, _, _, = rhythm_extractor(audio)

    # Use Essentia for key detection
    key, scale, strength = es.KeyExtractor()(audio)

    return tempo, f"{key} {scale}"  # Return key and scale (e.g., 'C major')

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