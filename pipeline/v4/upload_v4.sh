#!/usr/bin/env bash
# Upload the ALTO v4 bundle to alto.tfwelch.com over SSH and swap it in.
#
#   ./upload_v4.sh push      copy the bundle to a staging folder on the server
#   ./upload_v4.sh check     compare every staged file against bundle-manifest.json
#   ./upload_v4.sh swap      move the current files aside, move the new ones in
#   ./upload_v4.sh rollback  put the previous files back
#   ./upload_v4.sh status    what is live, what is staged, what is backed up
#   ./upload_v4.sh cleanup   delete the staging folder (keeps the backup)
#
# push is resumable: run it again after a dropped connection and it picks up the
# files it has not finished. Nothing on the live site changes until swap, and
# swap only moves files, so rollback is instant.
set -euo pipefail

SRC="${SRC:-/data/alto/working/alto_v4_20260917/deploy/alto_v4_upload_20260918015343}"
HOST="${HOST:?set HOST to the SSH host alias of the web server}"
LIVE="${LIVE:-alto.tfwelch.com}"
STAGE="${STAGE:-alto_stage_v4}"

# One SSH connection, reused by every command below: the server throttles new
# connections, and a fresh handshake per file is most of what makes SFTP slow.
CM="$HOME/.ssh/cm"
mkdir -p "$CM"
SSH_BASE=(-o ControlMaster=auto -o ControlPath="$CM/%r@%h:%p" -o ControlPersist=30m
          -o ServerAliveInterval=30 -o ServerAliveCountMax=6)
# The payload is .pmtiles and .json.gz, both already compressed; SSH compression
# would only burn CPU on both ends.
SSH_CMD="ssh -o Compression=no $(printf '%s ' "${SSH_BASE[@]}")"

sshx() { ssh "${SSH_BASE[@]}" "$HOST" "$@"; }

# The six things this release replaces. Everything else on the server is left
# alone: the other tilesets, exports, identity data, scripts, styles, .htaccess,
# kyte/ and field/.
ITEMS=(index.html release-metadata.json
       data/trees_map_points.pmtiles data/tree_crowns_pilot.pmtiles
       data/tree_change.pmtiles data/tree_details)

require_src() {
  [[ -d "$SRC" ]] || { echo "bundle not found: $SRC" >&2; exit 1; }
  [[ -f "$SRC/bundle-manifest.json" ]] || { echo "no bundle-manifest.json in $SRC" >&2; exit 1; }
}

# The shared host throttles disk WRITES to about 0.9 MB/s per process, while it
# reads at 1.2 GB/s and the link to it carries 4.8 MB/s. One stream therefore
# leaves three quarters of the link idle, and no client-side tool can do better
# on its own. Six writers roughly saturate the link instead. Each stream opens
# its own connection (the multiplexed master would share one), staggered because
# the server drops connections that arrive in a burst.
SSH_ONE="ssh -o BatchMode=yes -o Compression=no -o ControlPath=none -o ServerAliveInterval=30"

# The server resets connections that arrive in a burst, which kills a stream
# outright ("kex_exchange_identification: Connection reset by peer"). Every
# stream is restartable — rsync skips what it already sent, and a byte range is
# rewritten from the start — so just try again.
retry() {
  local label="$1"; shift
  local try
  for try in 1 2 3 4 5 6; do
    if "$@"; then
      [[ $try -gt 1 ]] && echo "  [$label] finished on try $try"
      return 0
    fi
    echo "  [$label] try $try failed; retrying in 20s" >&2
    sleep 20
  done
  echo "  [$label] GAVE UP after 6 tries" >&2
  return 1
}

rsync_stream() { rsync -a --partial -e "$SSH_ONE" "$@"; }

# Write one byte range of a local file straight into its place in the remote
# file, so a single large tileset is carried by several throttled writers.
push_range() {
  local src="$1" dst="$2" n="$3" sz mb part i
  sz="$(stat -f%z "$src")"
  mb=$(( (sz + 1048575) / 1048576 ))
  part=$(( (mb + n - 1) / n ))
  sshx "truncate -s $sz \"\$HOME/$dst\""
  for ((i = 0; i < n; i++)); do
    ( sleep $(( i * 6 )); retry "$(basename "$dst") range $i" push_one_range "$src" "$dst" $(( i * part )) "$part" ) &
  done
  wait
}

push_one_range() {  # local file, remote path, offset in MiB, length in MiB
  dd if="$1" bs=1m skip="$3" count="$4" 2>/dev/null |
    $SSH_ONE "$HOST" "dd of=\"\$HOME/$2\" bs=1M seek=$3 conv=notrunc status=none"
}

cmd_push() {
  require_src
  local t0=$SECONDS
  sshx "mkdir -p \"\$HOME/$STAGE/data/tree_details\""
  echo "==> parallel streams; the host writes at ~0.9 MB/s per process"

  push_range "$SRC/data/trees_map_points.pmtiles" "$STAGE/data/trees_map_points.pmtiles" 2 &
  ( sleep 12; push_range "$SRC/data/tree_crowns_pilot.pmtiles" "$STAGE/data/tree_crowns_pilot.pmtiles" 2 ) &
  # The details buckets are named in hex, so the leading character splits them
  # into even quarters; manifest.json, schema.json and .htaccess ride along with
  # the last one.
  ( sleep 24; retry 'details 0-3' rsync_stream --include='[0-3]*.json.gz' --exclude='*' \
      "$SRC/data/tree_details/" "$HOST:$STAGE/data/tree_details/" ) &
  ( sleep 30; retry 'details 4-7' rsync_stream --include='[4-7]*.json.gz' --exclude='*' \
      "$SRC/data/tree_details/" "$HOST:$STAGE/data/tree_details/" ) &
  ( sleep 36; retry 'details 8-b' rsync_stream --include='[89ab]*.json.gz' --exclude='*' \
      "$SRC/data/tree_details/" "$HOST:$STAGE/data/tree_details/" ) &
  ( sleep 42; retry 'details c-f' rsync_stream \
      --include='[c-f]*.json.gz' --include='manifest.json' --include='schema.json' \
      --include='.htaccess' --exclude='*' \
      "$SRC/data/tree_details/" "$HOST:$STAGE/data/tree_details/" ) &
  ( sleep 48
    retry 'page' rsync_stream "$SRC/index.html" "$SRC/release-metadata.json" \
      "$SRC/bundle-manifest.json" "$HOST:$STAGE/"
    retry 'tree_change' rsync_stream "$SRC/data/tree_change.pmtiles" "$HOST:$STAGE/data/" ) &
  wait
  echo "==> pushed in $(( (SECONDS - t0) / 60 ))m $(( (SECONDS - t0) % 60 ))s"
  cmd_status
}

cmd_check() {
  require_src
  # sha256 every staged file against the manifest the bundle was built with.
  python3 - "$SRC/bundle-manifest.json" > "$SRC/.manifest.sha256" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
for f in m["files"]:
    print(f"{f['sha256']}  {f['path']}")
PY
  rsync -a -e "$SSH_CMD" "$SRC/.manifest.sha256" "$HOST:$STAGE/manifest.sha256"
  echo "==> verifying $(wc -l < "$SRC/.manifest.sha256" | tr -d ' ') files on the server (a few minutes)"
  sshx "cd \$HOME/$STAGE && sha256sum -c --quiet manifest.sha256 && echo 'all files match the manifest'"
}

cmd_swap() {
  local ts; ts="$(date +%Y%m%d%H%M%S)"
  sshx "set -euo pipefail
    cd \"\$HOME/$LIVE\"
    for p in ${ITEMS[*]}; do
      [[ -e \"\$HOME/$STAGE/\$p\" ]] || { echo \"missing from staging: \$p\" >&2; exit 1; }
    done
    BK=\"\$HOME/alto_backup_$ts\"
    mkdir -p \"\$BK/data\"
    for p in ${ITEMS[*]}; do
      [[ -e \"\$p\" ]] && mv \"\$p\" \"\$BK/\$p\"
    done
    for p in ${ITEMS[*]}; do
      mv \"\$HOME/$STAGE/\$p\" \"\$p\"
    done
    echo \"\$BK\" > \"\$HOME/.alto_last_backup\"
    echo \"swapped. previous files: \$BK\""
}

cmd_rollback() {
  sshx "set -euo pipefail
    BK=\"\$(cat \"\$HOME/.alto_last_backup\" 2>/dev/null || true)\"
    [[ -n \"\$BK\" && -d \"\$BK\" ]] || { echo 'no backup recorded' >&2; exit 1; }
    cd \"\$HOME/$LIVE\"
    mkdir -p \"\$HOME/$STAGE/data\"
    for p in ${ITEMS[*]}; do
      [[ -e \"\$p\" ]] && mv \"\$p\" \"\$HOME/$STAGE/\$p\"
      [[ -e \"\$BK/\$p\" ]] && mv \"\$BK/\$p\" \"\$p\"
    done
    echo \"rolled back from \$BK; the new files are in \$HOME/$STAGE again\""
}

cmd_status() {
  sshx "set -u
    printf '%-14s %s\n' 'live:' \"\$HOME/$LIVE\"
    cd \"\$HOME/$LIVE\" 2>/dev/null && for p in ${ITEMS[*]}; do
      printf '  %-34s %8s  %s\n' \"\$p\" \"\$(du -sh \"\$p\" 2>/dev/null | cut -f1)\" \"\$(date -r \"\$p\" '+%Y-%m-%d %H:%M' 2>/dev/null)\"
    done
    echo
    if [[ -d \"\$HOME/$STAGE\" ]]; then
      echo \"staged: \$(du -sh \"\$HOME/$STAGE\" | cut -f1) in \$HOME/$STAGE\"
    else
      echo 'staged: nothing'
    fi
    BK=\"\$(cat \"\$HOME/.alto_last_backup\" 2>/dev/null || true)\"
    [[ -n \"\$BK\" && -d \"\$BK\" ]] && echo \"backup: \$(du -sh \"\$BK\" | cut -f1) in \$BK\" || echo 'backup: none'
    echo
    df -h \"\$HOME\" | tail -1 | awk '{print \"disk:   \" \$4 \" free\"}'"
}

# After a swap: check the public site actually serves the new release, and that
# the things this map depends on still hold — byte ranges, and .pmtiles arriving
# ungzipped (gzip plus Range returns corrupt partial content).
cmd_smoke() {
  local base="${BASE_URL:-https://alto.tfwelch.com}" ver fail=0
  # The host's mod_security answers 406 to curl's default agent string.
  local UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36"
  echo "==> $base"
  ver="$(curl -fsS -A "$UA" "$base/index.html" | grep -o 'AKL_TILE_VERSION="[0-9]*"' | head -1)"
  echo "  page stamp:      ${ver:-MISSING}"
  [[ "$ver" == *20260918015343* ]] || { echo "  !! page is not the new release"; fail=1; }
  local n
  n="$(curl -fsS -A "$UA" "$base/release-metadata.json" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("dataset",{}).get("tree_records","?"))' 2>/dev/null || echo "?")"
  echo "  metadata trees:  $n"
  for f in trees_map_points tree_crowns_pilot tree_change; do
    local hdr code enc len
    hdr="$(curl -fsS -A "$UA" -r 0-127 -D - -o /dev/null "$base/data/$f.pmtiles?v=20260918015343" 2>/dev/null)"
    code="$(printf '%s' "$hdr" | head -1 | awk '{print $2}')"
    enc="$(printf '%s' "$hdr" | grep -i '^content-encoding:' | tr -d '\r' || true)"
    len="$(printf '%s' "$hdr" | grep -i '^content-range:' | tr -d '\r' || true)"
    printf '  %-22s %s  %s%s\n' "$f.pmtiles" "${code:-ERR}" "${len:-no content-range}" "${enc:+  ($enc)}"
    [[ "$code" == 206 ]] || fail=1
    [[ -z "$enc" ]] || { echo "  !! $f is being gzipped; Range + gzip breaks the tiles"; fail=1; }
  done
  local dcode
  dcode="$(curl -fsS -A "$UA" -o /dev/null -w '%{http_code}' "$base/data/tree_details/000.json.gz?v=20260918015343" || echo ERR)"
  echo "  tree_details:    $dcode"
  [[ "$dcode" == 200 ]] || fail=1
  [[ $fail == 0 ]] && echo "==> live site looks right" || { echo "==> PROBLEMS above; ./upload_v4.sh rollback puts the old release back"; return 1; }
}

cmd_cleanup() {
  sshx "rm -rf \"\$HOME/$STAGE\" && echo 'staging folder removed (the backup is untouched)'"
}

case "${1:-status}" in
  push) cmd_push ;;
  check) cmd_check ;;
  swap) cmd_swap ;;
  smoke) cmd_smoke ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
  cleanup) cmd_cleanup ;;
  *) sed -n '2,16p' "$0"; exit 1 ;;
esac
