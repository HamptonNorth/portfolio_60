#!/bin/bash
# Build and install Portfolio 60
# Builds the latest version and installs the .deb package

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Kill any existing Portfolio 60 processes
echo "Stopping any running Portfolio 60 processes..."
pkill -f "portfolio-60" 2>/dev/null || true
pkill -f "bun.*src/server/index.js" 2>/dev/null || true
sleep 1

# Build the CSS first
echo "Building CSS..."
bun run build:css

# Capture build time BEFORE building - this gets bundled into the app
BUILD_TIME=$(date "+%Y-%m-%d %H:%M:%S")
echo "$BUILD_TIME" > "$SCRIPT_DIR/src/shared/build-time.txt"

echo "=========================================="
echo "Building Portfolio 60"
echo "Build timestamp: $BUILD_TIME"
echo "=========================================="

cd "$SCRIPT_DIR/src-tauri"
cargo tauri build --bundles deb --debug

# Find the latest .deb file (debug builds go to target/debug/bundle/deb/)
DEB_FILE=$(ls -t "$SCRIPT_DIR/src-tauri/target/debug/bundle/deb/"*.deb 2>/dev/null | head -1)

if [ -z "$DEB_FILE" ]; then
    echo "Error: No .deb file found after build"
    exit 1
fi

echo "Installing: $DEB_FILE"
sudo dpkg -i "$DEB_FILE"

echo "=========================================="
echo "Done! Portfolio 60 has been updated."
echo "Build timestamp: $BUILD_TIME"
echo "=========================================="
