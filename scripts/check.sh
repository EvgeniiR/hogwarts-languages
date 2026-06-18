#!/usr/bin/env bash
# Verify: syntax check all JS + module import graph for non-browser modules.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Syntax check ==="
FAILS=0
for f in js/*.js; do
  if ! node --check "$f" 2>/dev/null; then
    echo "  FAIL syntax: $f"
    node --check "$f" 2>&1 | sed 's/^/    /'
    FAILS=$((FAILS+1))
  fi
done
[ $FAILS -eq 0 ] && echo "  OK" || { echo "  $FAILS file(s) failed"; exit 1; }

echo "=== Module import graph ==="
node -e "
const BROWSER_ONLY=['main.js'];
const fs=require('fs');
const files=fs.readdirSync('js').filter(f=>f.endsWith('.js')&&!BROWSER_ONLY.includes(f));
let ok=true;
Promise.all(files.map(async f=>{
  try{
    const m=await import('./js/'+f);
    const fns=Object.entries(m).filter(([,v])=>typeof v==='function').map(([k])=>k);
    console.log('  OK','js/'+f,'→',fns.join(' ')||'(no functions)');
  }catch(e){
    console.log('  FAIL','js/'+f,'→',e.message);
    ok=false;
  }
})).then(()=>{if(!ok)process.exit(1);});
"
echo "=== Done ==="
