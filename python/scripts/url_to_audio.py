import sys
import yt_dlp
import traceback
import os
import json
import tempfile
import urllib.parse
import time

def sanitize_filename(filename):
    sanitized_filename = urllib.parse.quote(filename)
    return sanitized_filename

def cleanup_temp_dir(directory, age_threshold=3600):
    current_time = time.time()
    for filename in os.listdir(directory):
        file_path = os.path.join(directory, filename)
        if os.path.isfile(file_path):
            file_age = current_time - os.path.getmtime(file_path)
            if file_age > age_threshold:
                try:
                    os.remove(file_path)
                except Exception as e:
                    print(f"Failed to remove file: {file_path}, error: {e}", file=sys.stderr)

def download_audio(url, format):
    output_dir = tempfile.gettempdir()
    cleanup_temp_dir(output_dir)

    proxy_url = os.getenv('YT_DLP_PROXY_URL')
    print(f"PROXY URL ISSSSSSS: {proxy_url}", file=sys.stdout)

    def progress_hook(d):
        if d['status'] == 'downloading':
            # Print progress to stderr so it doesn't mix with the final JSON output
            print(f"Downloading: {d['_percent_str']} at {d['_speed_str']} ETA {d['_eta_str']}", file=sys.stdout, flush=True)

    ydl_opts = {
        'format': 'bestaudio',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': format,
            'preferredquality': '192',
        }],
        'outtmpl': os.path.join(output_dir, '%(title)s.%(ext)s'),
        'noplaylist': True,
        'progress_hooks': [progress_hook],
    }

    try:
        if proxy_url:
            encoded_proxy_url = urllib.parse.quote(proxy_url, safe=":/@?")
            ydl_opts['proxy'] = encoded_proxy_url
            print(f"Attempting download with proxy: {encoded_proxy_url}", file=sys.stdout)
            
        with yt_dlp.YoutubeDL(ydl_opts) as ydl: 
            info = ydl.extract_info(url, download=True)
            file_path = ydl.prepare_filename(info)
            base, ext = os.path.splitext(file_path)
            expected_file_path = f"{base}.{format}"

            if not os.path.isfile(expected_file_path):
                original_file_path = f"{base}.m4a"
                if os.path.isfile(original_file_path):
                    if format == 'aac':
                        os.rename(original_file_path, expected_file_path)
                    else:
                        os.rename(original_file_path, f"{base}.{format}")
                else:
                    raise FileNotFoundError(f"File not found: {expected_file_path}")

            sanitized_filename = sanitize_filename(os.path.basename(expected_file_path))
            sanitized_file_path = os.path.join(output_dir, sanitized_filename)
            os.rename(expected_file_path, sanitized_file_path)

            # Create a temporary file for the result
            result_file = os.path.join(output_dir, f"result_{int(time.time())}.json")
            result = {
                "title": info.get("title"),
                "file_path": sanitized_file_path,
                "file_name": sanitized_filename
            }

            # Write the result to the temporary file
            with open(result_file, 'w') as f:
                json.dump(result, f)

            # Print only the path to the result file
            print(f"RESULT_FILE:{result_file}", flush=True)

    except yt_dlp.utils.DownloadError as e:
        print(f"ERROR:{str(e)}", file=sys.stderr, flush=True)
        sys.exit(1)
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        print(f"ERROR:{str(e)}", file=sys.stderr, flush=True)
        sys.exit(1)

if __name__ == "__main__":
    url = sys.argv[1]
    format = sys.argv[2]
    download_audio(url, format)