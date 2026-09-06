#!/bin/bash
# gen.sh OUT.jpg ASPECT PROMPT [REF_IMAGE ...]
# Generates one image with Grok Build (image_gen, or image_edit when refs given) and copies it to OUT.
set -u
SELF_DIR=$(cd "$(dirname "$0")" && pwd)
OUT="$1"; ASPECT="$2"; PROMPT="$3"; shift 3
SCR="${TMPDIR:-/tmp}/blv-gen"; mkdir -p "$SCR/gen"
WORK=$(mktemp -d "$SCR/gen/job.XXXXXX")
OUTWIN=$(cygpath -w "$OUT")
MSG="$WORK/msg.txt"
if [ "$#" -gt 0 ]; then
  REFS=""
  for r in "$@"; do REFS="$REFS\"$(cygpath -w -a "$r")\", "; done   # absolute: the worker runs in its own cwd
  cat > "$MSG" <<MSGEOF
Call the image_edit tool exactly once. Use aspect_ratio "$ASPECT". Pass these reference image path(s) as the image input: [${REFS%, }]. Use this prompt VERBATIM, do not rewrite it:

$PROMPT

After the tool returns, copy the generated image file to exactly this path using run_terminal_cmd (create parent folders if needed): $OUTWIN
Then reply with the single word DONE followed by the saved path. Do not describe the image.
MSGEOF
else
  cat > "$MSG" <<MSGEOF
Call the image_gen tool exactly once with aspect_ratio "$ASPECT". Use this prompt VERBATIM, do not rewrite it:

$PROMPT

After the tool returns, copy the generated image file to exactly this path using run_terminal_cmd (create parent folders if needed): $OUTWIN
Then reply with the single word DONE followed by the saved path. Do not describe the image.
MSGEOF
fi
cd "$WORK" && timeout 420 cmd //c grokvpn --prompt-file "$(cygpath -w "$MSG")" --tools "image_gen,image_edit,run_terminal_cmd,read_file,list_dir" --permission-mode bypassPermissions --max-turns 8 --output-format json > "$WORK/result.json" 2> "$WORK/err.txt"
if [ -s "$OUT" ]; then echo "OK $OUT ($(stat -c %s "$OUT") bytes) work=$WORK via=grok"; exit 0; fi
# Grok Build balance exhausted (402) or any other failure: fall back to the Codex image tool.
if grep -q "402" "$WORK/result.json" "$WORK/err.txt" 2>/dev/null; then echo "grok 402, falling back to codex"; else echo "grok failed, falling back to codex"; tail -c 600 "$WORK/result.json"; fi
exec bash "$SELF_DIR/gen-image-codex.sh" "$OUT" "$ASPECT" "$PROMPT" "$@"
