# PCB Classification System — Browser-Only Setup Guide

This guide is written for:

- GitHub repository: `MarkMaelCruz/pcb-classification-system`
- React + Vite frontend at the repository root
- Flask backend inside `backend/`
- Vercel frontend hosting
- Google Cloud Run backend hosting
- Google Artifact Registry container storage
- Firebase Authentication and Cloud Firestore
- GitHub Actions CI/CD
- no local computer

The backend currently returns a **mock prediction**. The real object-detection model is added only after deployment and authentication work reliably.

---

## What each website or tool is for

| Website or tool | What you use it for |
|---|---|
| GitHub | Stores code, branches, pull requests, and Actions results |
| github.dev | Lightweight browser editor; it cannot run terminals, tests, or Docker |
| GitHub Codespaces | Browser-based development computer with an editor and terminal |
| GitHub Actions | Runs CI checks and deploys the backend |
| Firebase Console | Authentication, Firestore database, rules, and web-app configuration |
| Google Cloud Console | Billing, Cloud Run, Artifact Registry, IAM |
| Google Cloud Shell | Browser terminal already connected to Google Cloud |
| Vercel Dashboard | Builds and hosts the React/Vite frontend |

---

# Phase 1 — Put the generated files into your fork

## Step 1: Open a Codespace

1. Open your repository on GitHub.
2. Click the green **Code** button.
3. Open the **Codespaces** tab.
4. Click **Create codespace on main**.
5. Wait until the browser editor and terminal appear.

Use Codespaces instead of only `github.dev` because this phase needs a terminal, Python, Node.js, and Docker.

## Step 2: Create a feature branch

In the terminal at the bottom of Codespaces, paste:

```bash
git checkout -b feature/complete-cicd
```

You should now see `feature/complete-cicd` near the lower-left corner.

## Step 3: Add the generated package

The easiest method is the single bootstrap file:

1. Download `bootstrap_files.py` from the ChatGPT response.
2. In Codespaces, right-click the repository name in the Explorer.
3. Choose **New File**.
4. Name it exactly:

```text
bootstrap_files.py
```

5. Open the downloaded file, copy everything, paste it into the new Codespaces file, and save.
6. Run:

```bash
python bootstrap_files.py
```

This creates:

```text
.github/workflows/ci.yml
.github/workflows/deploy-backend.yml
backend/app.py
backend/Dockerfile
backend/.dockerignore
backend/.env.example
backend/requirements.txt
backend/tests/conftest.py
backend/tests/test_app.py
firebase/firestore.rules
firebase/firestore.indexes.json
firebase/storage.rules
firebase.json
.env.example
scripts/patch_frontend.py
docs/FRONTEND_PATCH.md
docs/GOOGLE_CLOUD_SETUP.md
README_SETUP.md
```

## Step 4: Patch the current frontend safely

Run:

```bash
python scripts/patch_frontend.py
```

This does not replace your interface. It only:

- removes unused history code that can fail ESLint
- adds the signed-in user's Firebase ID token to `/predict`
- stops the browser from creating trusted inspection records directly
- corrects the About text from FastAPI to Flask

## Step 5: Run all checks in Codespaces

Run each command separately:

```bash
npm ci
```

```bash
npm run lint
```

```bash
npm run build
```

```bash
python -m pip install -r backend/requirements.txt
```

```bash
PYTHONPATH=backend python -m pytest backend/tests -q
```

Then test Docker:

```bash
docker build -t pcb-api-test ./backend
```

```bash
docker run --rm -d \
  --name pcb-api-test \
  -p 8080:8080 \
  -e REQUIRE_AUTH=false \
  -e SAVE_RESULTS_TO_FIRESTORE=false \
  pcb-api-test
```

```bash
curl http://127.0.0.1:8080/health
```

Expected result:

```json
{
  "modelLoaded": false,
  "modelVersion": "mock-0.1.0",
  "service": "pcb-classification-api",
  "status": "healthy"
}
```

Stop the test container:

```bash
docker rm -f pcb-api-test
```

## Step 6: Commit and push

```bash
git status
```

```bash
git add .
```

```bash
git commit -m "Add Flask backend and CI/CD pipeline"
```

```bash
git push -u origin feature/complete-cicd
```

## Step 7: Create the pull request

1. Return to the GitHub repository page.
2. Click **Compare & pull request**.
3. Confirm:
   - base: `main`
   - compare: `feature/complete-cicd`
4. Title it:

```text
Add Flask backend and CI/CD pipeline
```

5. Click **Create pull request**.
6. Open the **Checks** area.

Do not merge until these three jobs are green:

- Frontend CI
- Backend CI
- Container CI

## STOP POINT 1

Do not configure Google Cloud deployment yet. Continue only after all three CI jobs pass.

---

# Phase 2 — Create Firebase from the beginning

Firebase supplies user login and Firestore. Vercel still hosts the website.

## Step 1: Create the Firebase project

1. Open Firebase Console.
2. Click **Create a project**.
3. Enter a project name such as:

```text
pcb-classification-system
```

4. Google Analytics is optional.
5. Finish the wizard.
6. Open the gear icon → **Project settings**.
7. Write down the exact **Project ID**.

The display name and Project ID are different. Deployment commands need the Project ID.

## Step 2: Register the React web app

1. In **Project settings**, find **Your apps**.
2. Click the web icon `</>`.
3. App nickname:

```text
pcb-classification-web
```

4. Do not enable Firebase Hosting. Vercel will host the frontend.
5. Click **Register app**.
6. Copy these values from the Firebase configuration:

```text
apiKey
authDomain
projectId
appId
storageBucket
```

They later become:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_STORAGE_BUCKET
```

These are client configuration values, not service-account private keys.

## Step 3: Enable sign-in methods

1. Firebase sidebar → **Authentication**.
2. Click **Get started**.
3. Open **Sign-in method**.
4. Enable **Email/Password**.
5. Enable **Google**.
6. For Google, choose a project support email and save.

## Step 4: Create Firestore

1. Firebase sidebar → **Firestore Database**.
2. Click **Create database**.
3. Choose **Production mode**.
4. Choose a region near your users and near Cloud Run.
5. Finish creation.

For a Philippines-focused project, this package uses Cloud Run region `asia-southeast1` unless you deliberately choose another region.

## Step 5: Publish Firestore rules

1. Firestore → **Rules**.
2. Open `firebase/firestore.rules` in GitHub or Codespaces.
3. Copy the whole file.
4. Replace the Firebase Rules editor contents.
5. Click **Publish**.

The rules allow:

- users to create and read their own profile
- admins to read user profiles
- users to read their own inspections
- admins to read all inspections and reports
- only the Flask backend to create trusted inspection records

## Step 6: Create the composite index

1. Firestore → **Indexes**.
2. Click **Create index**.
3. Collection ID:

```text
inspections
```

4. Add:
   - `uid` — Ascending
   - `timestamp` — Descending
5. Query scope: **Collection**
6. Click **Create**.

## Step 7: Make your account an admin later

After the Vercel site is online:

1. Sign up normally.
2. Firebase → Firestore → `users`.
3. Open your UID document.
4. Change `role` from `user` to `admin`.

Never allow a signup form to choose the admin role.

## Storage note

The present frontend does not upload image files to Firebase Storage; it sends the image directly to Flask and saves `imageUrl: null`. Leave Storage for a later phase unless permanent image retention is required.

## STOP POINT 2

Continue only when Authentication and Firestore exist and Firestore rules are published.

---

# Phase 3 — Prepare Google Cloud and keyless GitHub authentication

A Firebase project is also a Google Cloud project. Select the same project in Google Cloud Console.

## Step 1: Check billing first

1. Open Google Cloud Console.
2. Select the Firebase Project ID.
3. Open **Billing**.
4. Link a billing account if Cloud Run requires it.
5. Create a budget alert before deploying.

A budget alert warns you; it is not a hard spending cap.

## Step 2: Open Cloud Shell

Click the terminal-shaped **Activate Cloud Shell** icon near the top-right of Google Cloud Console.

## Step 3: Follow the command guide

Open:

```text
docs/GOOGLE_CLOUD_SETUP.md
```

Paste one command group at a time into Cloud Shell.

It creates:

- required Google APIs
- Artifact Registry repository
- GitHub deployment service account
- Cloud Run runtime service account
- Workload Identity Pool and provider
- IAM permissions restricted to your GitHub repository

It does not create or download a service-account JSON key.

## Step 4: Add GitHub Actions variables

GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **Variables**.

Create every variable printed by the Cloud Shell guide:

```text
GCP_PROJECT_ID
GCP_REGION
GAR_REPOSITORY
CLOUD_RUN_SERVICE
GCP_SERVICE_ACCOUNT
CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT
GCP_WORKLOAD_IDENTITY_PROVIDER
FIREBASE_PROJECT_ID
ALLOWED_ORIGINS
```

Initially set:

```text
ALLOWED_ORIGINS=http://localhost:5173
```

## STOP POINT 3

Continue only when Artifact Registry, both service accounts, and the Workload Identity provider exist.

---

# Phase 4 — Merge and deploy the backend

## Step 1: Merge only after CI passes

1. Return to the pull request.
2. Confirm all three CI jobs are green.
3. Click **Merge pull request**.
4. Confirm merge.

## Step 2: Watch `main` CI

1. Repository → **Actions**.
2. Open the newest **CI** run.
3. Confirm all three jobs pass again on `main`.

## Step 3: Watch backend deployment

The **Deploy backend** workflow starts only after a successful `main` CI run.

Check these steps:

- authenticate to Google Cloud
- configure Artifact Registry
- build and push the SHA-tagged image
- deploy Cloud Run
- request `/health`

At the bottom, copy the printed Cloud Run URL.

Use only the base URL:

```text
https://pcb-classification-api-xxxxx.asia-southeast1.run.app
```

Do not append `/predict` because the React code already appends it.

## Step 4: Verify health manually

Open:

```text
YOUR_CLOUD_RUN_URL/health
```

Expected status is `healthy`.

Cloud Run is publicly reachable at the network level so the browser can call it. Flask still rejects `/predict` requests without a valid Firebase ID token.

## STOP POINT 4

Continue only after the public `/health` page returns healthy JSON.

---

# Phase 5 — Deploy the React frontend to Vercel

## Step 1: Import the fork

1. Open Vercel Dashboard.
2. Sign in with GitHub.
3. Click **Add New** → **Project**.
4. Import:

```text
MarkMaelCruz/pcb-classification-system
```

5. Confirm:
   - Framework Preset: **Vite**
   - Root Directory: `./`
   - Build Command: `npm run build`
   - Output Directory: `dist`

## Step 2: Add Vercel environment variables

Before deployment, add:

```text
VITE_API_URL
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_STORAGE_BUCKET
```

Set `VITE_API_URL` to the Cloud Run base URL without `/predict`.

Use the Firebase web-app configuration for the other values.

Never place service-account JSON, private keys, or backend secrets in variables beginning with `VITE_`. Vite exposes those values to browser code.

Apply them to **Production** and **Preview**.

## Step 3: Deploy

Click **Deploy**.

Copy the production domain, for example:

```text
your-project.vercel.app
```

## Step 4: Add the domain to Firebase Authentication

1. Firebase Console → **Authentication**.
2. Open **Settings** → **Authorized domains**.
3. Add only the domain:

```text
your-project.vercel.app
```

Do not include `https://`.

## Step 5: Add the Vercel origin to Flask CORS

1. GitHub repository → **Settings**.
2. **Secrets and variables** → **Actions** → **Variables**.
3. Edit `ALLOWED_ORIGINS`.
4. Set:

```text
http://localhost:5173,https://your-project.vercel.app
```

5. Repository → **Actions**.
6. Open **Deploy backend**.
7. Click **Run workflow** on `main`.

This creates a new Cloud Run revision with the Vercel origin allowed.

## Step 6: Test the full flow

1. Open the Vercel website.
2. Create an account.
3. Sign in.
4. Upload a valid JPG or PNG.
5. Click **Analyze Image**.
6. Check that:
   - a mock Solder Bridge prediction appears
   - a bounding box appears in Detection Output
   - Firestore receives an `inspections` record
   - the record contains your Firebase UID
   - the backend response says `"mock": true`

## STOP POINT 5

At this point the full mock CI/CD system is complete.

---

# Phase 6 — Replace the mock with the real ML model later

Do this only after the preceding phases work.

Decide the final model format first:

- Ultralytics/PyTorch
- ONNX
- TensorFlow

Then:

1. add the matching inference dependency
2. place or download the model safely
3. load it once when the container starts
4. convert detections to the existing `defects` response list
5. preserve percentage bounding-box values from 0 to 100
6. add model tests
7. increase Cloud Run memory or CPU only if measurements show it is needed

Do not store a large private model in a public GitHub repository unless that is intentional.

---

# Troubleshooting map

## Frontend CI fails at ESLint

Open the failed **Frontend CI** job and read the exact filename and line. The supplied patch targets the currently visible unused history code; do not disable ESLint globally.

## Backend CI cannot import `app`

Confirm `ci.yml` contains:

```yaml
env:
  PYTHONPATH: ${{ github.workspace }}/backend
```

and runs:

```bash
python -m pytest backend/tests -q
```

## Container CI is skipped

It depends on Backend CI. Fix Backend CI first.

## Google authentication fails

Check these repository variables carefully:

```text
GCP_WORKLOAD_IDENTITY_PROVIDER
GCP_SERVICE_ACCOUNT
```

The provider value must be the complete resource name printed by Cloud Shell.

## Cloud Run starts but health fails

Open Cloud Run → service → **Logs**. Confirm:

- the container listens on `PORT`
- the runtime service account exists
- `FIREBASE_PROJECT_ID` is correct

## Browser shows a CORS error

The exact Vercel origin must be in `ALLOWED_ORIGINS`, including `https://` and without a trailing slash. Redeploy the backend after editing the variable.

## `/predict` returns 401

Confirm the frontend patch ran and the request contains:

```text
Authorization: Bearer <Firebase ID token>
```

Also confirm the Vercel Firebase variables belong to the same Firebase project used by the Flask backend.
