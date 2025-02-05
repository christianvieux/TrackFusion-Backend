#  python/scripts/bpm_analyzer.py
import essentia
import essentia.standard as es
import json

def analyze_bpm(file_path, min_bpm=50, max_bpm=100):
    loader = es.MonoLoader(filename=file_path)
    audio = loader()

    rhythm_extractor = es.RhythmExtractor2013(method="multifeature", minTempo=min_bpm, maxTempo=max_bpm)
    bpm, _, _, _, _ = rhythm_extractor(audio)

    return round(float(bpm), 3)

if __name__ == "__main__":
    import sys
    file_path = sys.argv[1]
    min_bpm = int(sys.argv[2]) if len(sys.argv) > 2 else 50
    max_bpm = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    bpm = analyze_bpm(file_path, min_bpm, max_bpm)
    print(json.dumps({"bpm": bpm}))