'''Apply targeted changes to the current src/App.jsx.

Run from the repository root:
    python scripts/patch_frontend.py
'''

from pathlib import Path
import re
import sys

path = Path("src/App.jsx")
if not path.exists():
    sys.exit("src/App.jsx was not found. Run this script from the repository root.")

text = path.read_text(encoding="utf-8")
original = text

# These patterns work whether App.jsx is neatly formatted or mostly on one line.
text, history_state_count = re.subn(
    r'\s*const \[history, setHistory\] = useState\(\[\]\);',
    " ",
    text,
    count=1,
)
text, history_loading_count = re.subn(
    r'\s*const \[historyLoading, setHistoryLoading\] = useState\(false\);',
    " ",
    text,
    count=1,
)
text = text.replace("setHistory([]);", "")

text, history_callback_count = re.subn(
    r'\s*const loadHistory = useCallback\(async \(\) => \{.*?\}, \[authUser\]\);',
    " ",
    text,
    count=1,
    flags=re.DOTALL,
)

fetch_pattern = re.compile(
    r'const\s+formData\s*=\s*new\s+FormData\(\);\s*'
    r'formData\.append\("file",\s*imageFile\);\s*'
    r'const\s+res\s*=\s*await\s+fetch\(`\$\{API_URL\}/predict`,\s*\{\s*'
    r'method:\s*"POST",\s*body:\s*formData,\s*\}\s*\);',
    re.DOTALL,
)

new_fetch = '''if (!API_URL) {
      throw new Error("VITE_API_URL is not configured.");
    }

    const formData = new FormData();
    formData.append("file", imageFile);

    const idToken = await authUser.getIdToken();
    const res = await fetch(`${API_URL}/predict`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
      body: formData,
    });'''

if "Authorization: `Bearer ${idToken}`" not in text:
    text, fetch_count = fetch_pattern.subn(new_fetch, text, count=1)
    if fetch_count != 1:
        sys.exit(
            "Could not find the expected /predict fetch block in src/App.jsx. "
            "No file was written."
        )
else:
    fetch_count = 0

inspection_pattern = re.compile(
    r'\s*await\s+addDoc\(collection\(db,\s*"inspections"\),\s*'
    r'\{.*?\}\s*\);\s*(?=setLatestResult\()',
    re.DOTALL,
)
text, inspection_count = inspection_pattern.subn(" ", text, count=1)

text = text.replace(
    "Images are processed by a FastAPI",
    "Images are processed by a Flask",
)

if text == original:
    print("No changes were needed. The frontend may already be patched.")
    raise SystemExit(0)

path.write_text(text, encoding="utf-8")
print("Updated src/App.jsx")
print(f"- Removed history state: {bool(history_state_count)}")
print(f"- Removed history loading state: {bool(history_loading_count)}")
print(f"- Removed dead loadHistory callback: {bool(history_callback_count)}")
print(f"- Added Firebase bearer token: {bool(fetch_count)}")
print(f"- Removed direct browser inspection write: {bool(inspection_count)}")
print("- Updated FastAPI wording to Flask")
