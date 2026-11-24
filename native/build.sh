#!/bin/sh
# Rebuilds native/vision_ocr as a universal (arm64 + x86_64) binary for macOS 11+.
set -eu
cd "$(dirname "$0")"
tmp=$(mktemp -d)
swiftc -O -target arm64-apple-macos11 vision_ocr.swift -o "$tmp/arm64"
swiftc -O -target x86_64-apple-macos11 vision_ocr.swift -o "$tmp/x86_64"
lipo -create "$tmp/arm64" "$tmp/x86_64" -output vision_ocr
strip -x vision_ocr 2>/dev/null || true
codesign --force --sign - vision_ocr
rm -rf "$tmp"
lipo -info vision_ocr
