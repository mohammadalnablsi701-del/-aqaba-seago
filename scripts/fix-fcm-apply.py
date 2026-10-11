from pathlib import Path

path=Path(__file__).resolve().with_name("apply-fcm-code-prep.py")
lines=path.read_text(encoding="utf-8").splitlines()
changed=False
for index,line in enumerate(lines):
    if "const API_BASE = String(import.meta.env.VITE_API_BASE_URL" in line and line.strip().startswith("'const API_BASE"):
        lines[index] = "    'const API_BASE = String(import.meta.env.VITE_API_BASE_URL || \"\").replace(/\\\\/$/, \"\");\\n',"
        changed=True
        break
if not changed:
    raise SystemExit("API_BASE matcher line not found")
path.write_text("\n".join(lines)+"\n",encoding="utf-8")
print("FCM apply patch corrected")
