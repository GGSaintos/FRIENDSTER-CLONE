#!/usr/bin/env bash
# Render build step: install app deps, then drop self-contained yt-dlp +
# ffmpeg binaries into ./bin so the YouTube-import endpoint works on the
# deployed server (no root / apt-get needed on Render's native runtime).
set -euo pipefail

npm install

mkdir -p bin

echo "==> downloading yt-dlp (self-contained linux binary)"
curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
  -o bin/yt-dlp
chmod +x bin/yt-dlp

echo "==> downloading static ffmpeg + ffprobe"
curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  -o /tmp/ffmpeg.tar.xz
tar -xf /tmp/ffmpeg.tar.xz -C /tmp
FFDIR="$(find /tmp -maxdepth 1 -type d -name 'ffmpeg-*-static' | head -1)"
cp "$FFDIR/ffmpeg" "$FFDIR/ffprobe" bin/
chmod +x bin/ffmpeg bin/ffprobe

echo "==> installed:"
./bin/yt-dlp --version || true
./bin/ffmpeg -version | head -1 || true
