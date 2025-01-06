# python/scripts/key_analyzer.py

import librosa
import json

def analyze_key(file_path):
    y, sr = librosa.load(file_path)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    key = librosa.core.hz_to_note(chroma.argmax())
    return key

if __name__ == "__main__":
    import sys
    file_path = sys.argv[1]
    key = analyze_key(file_path)
    print(json.dumps({"key": key}))