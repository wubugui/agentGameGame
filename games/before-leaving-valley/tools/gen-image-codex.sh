#!/bin/bash
# gen-image-codex.sh OUT ASPECT PROMPT [REF_IMAGE ...]
# Same contract as gen-image.sh, but through the OpenAI Codex CLI's image generation tool.
# Notes: Codex regenerates rather than editing pixel-for-pixel, so with REF images it keeps place/style but
# not the exact composition; it is right for new paintings, whole repaints and sprites, weak for surgical removals.
set -u
OUT="$1"; ASPECT="$2"; PROMPT="$3"; shift 3
CODEX="${CODEX:-C:/Users/weiruanrinima/AppData/Local/OpenAI/Codex/bin/9ba750cce02d5e5c/codex.exe}"
# A plain long path: the Codex sandbox rejects 8.3 short names such as WEIRUA~1 (access denied, "ref1.jpg is missing").
SCR="$HOME/.blv-gen"; mkdir -p "$SCR/codex"
WORK=$(mktemp -d "$SCR/codex/job.XXXXXX")
OUTWIN=$(cygpath -w -l -a "$OUT")
PNG="$WORK/out.png"; PNGWIN=$(cygpath -w -l -a "$PNG")
case "$ASPECT" in
  16:9) SHAPE="landscape 16:9" ;; 9:16) SHAPE="portrait 9:16" ;; 4:3) SHAPE="landscape 4:3" ;; 3:4) SHAPE="portrait 3:4" ;; *) SHAPE="square 1:1" ;;
esac
REFARGS=()
if [ "$#" -gt 0 ]; then
  n=0
  for r in "$@"; do
    n=$((n+1)); ref="$WORK/ref$n.jpg"
    case "$r" in *.webp|*.WEBP) ffmpeg -v error -y -i "$r" -vf scale=1280:-2 "$ref" ;; *) cp "$r" "$ref" ;; esac
    REFARGS+=(-i "$(cygpath -w -l -a "$ref")")
  done
  PRE="The attached image(s) are paintings from our game and are the STYLE and PLACE reference (same mountains, same brushwork, same palette, same light). Use your image generation tool once, at the highest resolution available, $SHAPE, to paint:"
else
  PRE="Use your image generation tool once, at the highest resolution available, $SHAPE, to create:"
fi
printf '%s\n\n%s\n\nSave the generated image file to exactly this path: %s\nThen reply with the single word DONE followed by the saved path. Do not describe the image.\n' "$PRE" "$PROMPT" "$PNGWIN" > "$WORK/msg.txt"
mkdir -p "$(dirname "$OUT")"
# Retry on capacity errors / empty runs (OpenAI returns "Selected model is at capacity" intermittently).
for attempt in 1 2 3; do
  ( cd "$WORK" && timeout 480 "$CODEX" exec --skip-git-repo-check -s workspace-write -C "$(cygpath -w -l -a "$WORK")" "${REFARGS[@]}" - < "$WORK/msg.txt" > "$WORK/result.txt" 2> "$WORK/err.txt" )
  [ -s "$PNG" ] && break
  if grep -Eq "at capacity|rate limit|overloaded|429|5[0-9][0-9]" "$WORK/err.txt" "$WORK/result.txt" 2>/dev/null || [ ! -s "$WORK/result.txt" ]; then echo "codex attempt $attempt failed (capacity/empty), retrying" >&2; sleep $((attempt * 20)); else break; fi
done
if [ -s "$PNG" ]; then
  case "$OUT" in
    *.png|*.PNG) cp "$PNG" "$OUT" ;;
    *) ffmpeg -v error -y -i "$PNG" -q:v 2 "$OUT" ;;
  esac
fi
if [ -s "$OUT" ]; then echo "OK $OUT ($(stat -c %s "$OUT") bytes) work=$WORK via=codex"; else echo "FAIL $OUT work=$WORK via=codex"; tail -c 800 "$WORK/result.txt"; tail -c 400 "$WORK/err.txt"; fi
