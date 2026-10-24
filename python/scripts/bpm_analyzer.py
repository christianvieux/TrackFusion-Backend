import json
import sys

import librosa
import numpy as np


def analyze_bpm(file_path, min_bpm=50, max_bpm=200):
    if min_bpm <= 0 or max_bpm <= min_bpm:
        raise ValueError("BPM range must contain positive values with min below max")

    audio, sample_rate = librosa.load(file_path, sr=None, mono=True)
    tempo, _ = librosa.beat.beat_track(
        y=audio,
        sr=sample_rate,
        start_bpm=(min_bpm + max_bpm) / 2,
    )
    detected_bpm = float(np.asarray(tempo).reshape(-1)[0])

    octave_candidates = [
        detected_bpm * (2 ** octave)
        for octave in range(-4, 5)
        if min_bpm <= detected_bpm * (2 ** octave) <= max_bpm
    ]
    if octave_candidates:
        midpoint = (min_bpm + max_bpm) / 2
        detected_bpm = min(octave_candidates, key=lambda bpm: abs(bpm - midpoint))

    return round(detected_bpm, 3)


if __name__ == "__main__":
    input_file = sys.argv[1]
    minimum_bpm = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    maximum_bpm = int(sys.argv[3]) if len(sys.argv) > 3 else 200
    print(json.dumps({"bpm": analyze_bpm(input_file, minimum_bpm, maximum_bpm)}))
