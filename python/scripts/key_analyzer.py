import json
import sys

import librosa
import numpy as np


NOTE_NAMES = np.array(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"])
MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def analyze_key(file_path):
    audio, sample_rate = librosa.load(file_path, sr=None, mono=True)
    chroma = librosa.feature.chroma_cqt(y=audio, sr=sample_rate)
    pitch_profile = chroma.mean(axis=1)

    candidates = []
    for tonic in range(12):
        major_score = np.corrcoef(pitch_profile, np.roll(MAJOR_PROFILE, tonic))[0, 1]
        minor_score = np.corrcoef(pitch_profile, np.roll(MINOR_PROFILE, tonic))[0, 1]
        candidates.append((major_score, tonic, "major"))
        candidates.append((minor_score, tonic, "minor"))

    _, tonic, scale = max(candidates, key=lambda candidate: candidate[0])
    return f"{NOTE_NAMES[tonic]} {scale}"


if __name__ == "__main__":
    print(json.dumps({"key": analyze_key(sys.argv[1])}))
