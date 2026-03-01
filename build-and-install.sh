#!/bin/bash
set -e

APP_ID="com.rcollins.portfolio_60"
MANIFEST="$APP_ID.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- PHASE 1: TOOLBOX (COMPILATION) ---
if [ -f "/run/.containerenv" ]; then
    echo "=========================================="
    echo "📦 [Phase 1] Compiling in Toolbox"
    echo "=========================================="

    # Setup Environment
    [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
    export PATH="$HOME/.bun/bin:$PATH"

    # Update Build Time
    BUILD_TIME=$(date "+%Y-%m-%d %H:%M:%S")
    echo "$BUILD_TIME" > "$SCRIPT_DIR/src/config/build-time.txt"

    # Run Rust/Bun Build
    cd "$SCRIPT_DIR"
    bun install
    bun tauri build --no-bundle

    # Copy bun binary for Flatpak bundling
    cp "$(which bun)" "$SCRIPT_DIR/src-tauri/target/release/bun"

    echo "✅ Compilation successful."
    echo "🚀 Handing off to Host for Flatpak Bundling..."

    # Trigger Phase 2 on the Host
    flatpak-spawn --host "$SCRIPT_DIR/build-and-install.sh" --host-phase
    exit 0
fi

# --- PHASE 2: HOST (PACKAGING & RUNNING) ---
if [ "$1" == "--host-phase" ]; then
    echo "=========================================="
    echo "🖥️  [Phase 2] Packaging on Host"
    echo "=========================================="

    cd "$SCRIPT_DIR"

    # Ensure Host has builder installed
    if ! command -v flatpak-builder &> /dev/null; then
        echo "❌ flatpak-builder not found on Host. Please run: sudo rpm-ostree install flatpak-builder && reboot"
        exit 1
    fi

    # Build the Flatpak
    flatpak-builder --user --install --force-clean build-dir "$MANIFEST"

    echo "🎉 Build Complete! Launching..."
    flatpak run "$APP_ID" &
    exit 0
fi

echo "❌ Please start this script from INSIDE your toolbox."
exit 1
