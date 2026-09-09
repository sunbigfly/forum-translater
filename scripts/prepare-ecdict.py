"""Build the offline core dictionary: python3 scripts/prepare-ecdict.py /path/to/ecdict.csv."""
import base64
import csv
import gzip
import json
from pathlib import Path
import sys

rows = []
with open(sys.argv[1], encoding="utf-8") as source:
    for row in csv.DictReader(source):
        tags = row["tag"].split()
        frequency = int(row["frq"] or 0)
        if row["oxford"] == "1" or any(tag in tags for tag in ("cet4", "cet6")) or 0 < frequency <= 20000:
            rows.append([row["word"], row["phonetic"], row["translation"].replace("\\n", "\n"), row["tag"], row["exchange"], row["pos"]])
compressed = gzip.compress(json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode(), mtime=0)
output = Path(__file__).resolve().parent.parent / "src/wordbook-ecdict-data.ts"
output.write_text("// ECDICT core vocabulary snapshot, MIT. See THIRD_PARTY_NOTICES.md.\nexport const ecdictData = " + json.dumps(base64.b64encode(compressed).decode()) + ";\n", encoding="utf-8")
print(json.dumps({"words": len(rows), "compressed_bytes": len(compressed)}))
