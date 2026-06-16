# What the frontend patch changes

The current `src/App.jsx` already:

- initializes Firebase
- supports email/password and Google login
- reads and writes Firestore data
- sends the image to `${VITE_API_URL}/predict`
- uses multipart field name `file`

Run this from the repository root in Codespaces:

```bash
python scripts/patch_frontend.py
```

The script makes four targeted changes:

1. Removes unused `history`, `historyLoading`, and `loadHistory` code that can fail ESLint.
2. Gets the signed-in user's Firebase ID token.
3. Sends `Authorization: Bearer <token>` to Flask.
4. Removes the direct browser write to `inspections` because the Flask backend now writes the trusted record.

It does not replace your UI or CSS.
