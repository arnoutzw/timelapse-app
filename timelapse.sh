#!/bin/bash

# Ring Camera Timelapse Script (Standalone — no Home Assistant)
# Calls snapshot.mjs in a loop, then stitches with FFmpeg.

set -e

# Configuration (overridable via environment)
SNAPSHOTS_DIR="${SNAPSHOTS_DIR:-snapshots}"
OUTPUT_VIDEO="${OUTPUT_VIDEO:-timelapse.mp4}"
CAPTURE_INTERVAL="${CAPTURE_INTERVAL:-30}"
TOTAL_DURATION="${TOTAL_DURATION:-3600}"
FRAMERATE="${FRAMERATE:-30}"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -d|--dir)        SNAPSHOTS_DIR="$2";    shift 2 ;;
    -o|--output)     OUTPUT_VIDEO="$2";     shift 2 ;;
    -i|--interval)   CAPTURE_INTERVAL="$2"; shift 2 ;;
    -t|--total-duration) TOTAL_DURATION="$2"; shift 2 ;;
    -f|--framerate)  FRAMERATE="$2";        shift 2 ;;
    -h|--help)
      echo "Usage: $0 [options]"
      echo "  -d, --dir DIR              Snapshot directory (default: snapshots)"
      echo "  -o, --output FILE          Output video (default: timelapse.mp4)"
      echo "  -i, --interval SECONDS     Seconds between snapshots (min 15, default: 30)"
      echo "  -t, --total-duration SECS  Total duration in seconds (default: 3600)"
      echo "  -f, --framerate FPS        Output FPS (default: 30)"
      exit 0 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Enforce minimum interval
if [ "$CAPTURE_INTERVAL" -lt 15 ]; then
  echo "Warning: interval ${CAPTURE_INTERVAL}s is below minimum 15s, clamping."
  CAPTURE_INTERVAL=15
fi

mkdir -p "$SNAPSHOTS_DIR"
NUM_SNAPSHOTS=$((TOTAL_DURATION / CAPTURE_INTERVAL))

echo "Ring Timelapse: $NUM_SNAPSHOTS snapshots at ${CAPTURE_INTERVAL}s intervals"
echo "Output: $OUTPUT_VIDEO at ${FRAMERATE} fps"

START_TIME=$(date +%s)

for ((i=1; i<=NUM_SNAPSHOTS; i++)); do
  SNAPSHOT_PATH="$SNAPSHOTS_DIR/snapshot_$(printf "%05d" $i).jpg"

  echo "[$i/$NUM_SNAPSHOTS] Capturing..."
  node snapshot.mjs "$SNAPSHOT_PATH"

  if [ $? -ne 0 ]; then
    echo "Failed to capture snapshot $i"
    continue
  fi

  if [ $i -lt $NUM_SNAPSHOTS ]; then
    ELAPSED=$(($(date +%s) - START_TIME))
    REMAINING=$((TOTAL_DURATION - ELAPSED))
    echo "Sleeping ${CAPTURE_INTERVAL}s (elapsed: ${ELAPSED}s, remaining: ${REMAINING}s)"
    sleep "$CAPTURE_INTERVAL"
  fi
done

echo "Creating video..."
if command -v ffmpeg &> /dev/null; then
  ffmpeg -y -framerate "$FRAMERATE" \
    -pattern_type glob -i "$SNAPSHOTS_DIR/snapshot_*.jpg" \
    -c:v libx264 -pix_fmt yuv420p \
    "$OUTPUT_VIDEO"
  echo "Done: $OUTPUT_VIDEO"
  ls -lh "$OUTPUT_VIDEO"
else
  echo "FFmpeg not found. Install: apt-get install ffmpeg"
  exit 1
fi
