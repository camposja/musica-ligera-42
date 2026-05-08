#!/bin/sh
set -e

hook=".git/hooks/post-checkout"
helper=".git/hooks/switch-local-env.sh"

if [ -f "$hook" ]; then
  echo "Existing hook at $hook — refusing to overwrite."
  echo "Installing helper at $helper for manual hook integration."
  cp scripts/switch-local-env.sh "$helper"
  chmod +x "$helper"
  echo "Add this line manually to your post-checkout hook:"
  echo '  [ "$3" = "1" ] && .git/hooks/switch-local-env.sh auto'
  exit 1
fi

mkdir -p .git/hooks
cp scripts/switch-local-env.sh "$helper"
chmod +x "$helper"

cat > "$hook" <<'EOF'
#!/bin/sh
[ "$3" = "1" ] || exit 0
.git/hooks/switch-local-env.sh auto
EOF

chmod +x "$hook"
echo "Installed local post-checkout hook for branch-aware .env switching."
