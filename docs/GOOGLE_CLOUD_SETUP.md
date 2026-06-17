# Google Cloud setup using only the browser

Use the **same Google Cloud project that belongs to your Firebase project**.

Open Google Cloud Console, select the Firebase project, and click the **Cloud Shell** icon. Paste the commands one group at a time.

## 1. Choose names

Replace only `YOUR_FIREBASE_PROJECT_ID`.

```bash
export PROJECT_ID="YOUR_FIREBASE_PROJECT_ID"
export REGION="asia-southeast1"
export GAR_REPOSITORY="pcb-backend"
export CLOUD_RUN_SERVICE="pcb-classification-api"
export DEPLOY_SA_NAME="github-deployer"
export RUNTIME_SA_NAME="pcb-api-runtime"
export GITHUB_OWNER="MarkMaelCruz"
export GITHUB_REPO="pcb-classification-system"

gcloud config set project "$PROJECT_ID"
export PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
export DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
export RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Project number: $PROJECT_NUMBER"
```

## 2. Enable the APIs

```bash
gcloud services enable   artifactregistry.googleapis.com   run.googleapis.com   iamcredentials.googleapis.com   sts.googleapis.com   cloudresourcemanager.googleapis.com   firestore.googleapis.com
```

## 3. Create Artifact Registry

```bash
gcloud artifacts repositories create "$GAR_REPOSITORY"   --repository-format=docker   --location="$REGION"   --description="PCB Flask backend images"
```

If it says the repository already exists, continue.

## 4. Create service accounts

```bash
gcloud iam service-accounts create "$DEPLOY_SA_NAME"   --display-name="GitHub Actions deployer"

gcloud iam service-accounts create "$RUNTIME_SA_NAME"   --display-name="PCB Cloud Run runtime"
```

If either account already exists, continue.

## 5. Grant roles

The GitHub deployer can push images and deploy Cloud Run. The runtime account can write trusted inspection records to Firestore.

```bash
gcloud projects add-iam-policy-binding "$PROJECT_ID"   --member="serviceAccount:${DEPLOY_SA}"   --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding "$PROJECT_ID"   --member="serviceAccount:${DEPLOY_SA}"   --role="roles/run.admin"

gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA"   --member="serviceAccount:${DEPLOY_SA}"   --role="roles/iam.serviceAccountUser"

gcloud projects add-iam-policy-binding "$PROJECT_ID"   --member="serviceAccount:${RUNTIME_SA}"   --role="roles/datastore.user"
```

## 6. Create Workload Identity Federation

This gives GitHub Actions short-lived credentials. No service-account JSON key is created.

```bash
gcloud iam workload-identity-pools create "github"   --location="global"   --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "github-provider"   --location="global"   --workload-identity-pool="github"   --display-name="GitHub repository provider"   --issuer-uri="https://token.actions.githubusercontent.com"   --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner"   --attribute-condition="assertion.repository=='${GITHUB_OWNER}/${GITHUB_REPO}'"
```

If the pool or provider already exists, do not recreate it.

Grant only this repository permission to impersonate the deployer:

```bash
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA"   --role="roles/iam.workloadIdentityUser"   --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${GITHUB_OWNER}/${GITHUB_REPO}"
```

## 7. Print the GitHub variable values

```bash
echo "GCP_PROJECT_ID=$PROJECT_ID"
echo "GCP_REGION=$REGION"
echo "GAR_REPOSITORY=$GAR_REPOSITORY"
echo "CLOUD_RUN_SERVICE=$CLOUD_RUN_SERVICE"
echo "GCP_SERVICE_ACCOUNT=$DEPLOY_SA"
echo "CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT=$RUNTIME_SA"

gcloud iam workload-identity-pools providers describe "github-provider"   --location="global"   --workload-identity-pool="github"   --format="value(name)"
```

Copy the last command's output as `GCP_WORKLOAD_IDENTITY_PROVIDER`.

## 8. Add repository variables in GitHub

Repository → **Settings** → **Secrets and variables** → **Actions** → **Variables**.

Create:

- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GAR_REPOSITORY`
- `CLOUD_RUN_SERVICE`
- `GCP_SERVICE_ACCOUNT`
- `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT`
- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `FIREBASE_PROJECT_ID`
- `ALLOWED_ORIGINS`

Start `ALLOWED_ORIGINS` with:

```text
http://localhost:5173
```

After Vercel gives you a production URL, change it to:

```text
http://localhost:5173,https://YOUR-PROJECT.vercel.app
```

Then manually run **Actions → Deploy backend → Run workflow**.
