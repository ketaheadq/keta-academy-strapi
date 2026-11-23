import argparse

import yt_dlp


def main():
    parser = argparse.ArgumentParser(description="List videos in a YouTube playlist.")
    parser.add_argument("url", help="YouTube playlist URL")
    args = parser.parse_args()

    ydl_opts = {
        "extract_flat": True,
        "quiet": True,
        "extractor_args": {"youtube": {"lang": ["tr"]}},
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(args.url, download=False)
        for entry in info["entries"]:
            print(f"{entry['title']} | {entry['url']}")


if __name__ == "__main__":
    main()