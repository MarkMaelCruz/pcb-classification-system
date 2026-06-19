/**
 * PCB Solder Defect Classifier
 * Frontend: React + Vite
 * Auth/Database: Firebase Authentication + Firestore
 * Backend API: Flask on Cloud Run through VITE_API_URL
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

import HistoryPanel from "./HistoryPanel.jsx";

const firebaseApp = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
});

const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const googleProvider = new GoogleAuthProvider();
const API_URL = import.meta.env.VITE_API_URL;

const EMPTY_RESULT = {
  prediction: "Waiting",
  defect: "Upload an image to begin classification.",
  confidence: 0,
  recommendation: "Recommendation will appear after the image is analyzed.",
  defects: [],
};

const ADMIN_NAV = [{ id: "dashboard", label: "Dashboard" }];

const USER_NAV = [
  { id: "home", label: "Home" },
  { id: "upload", label: "Upload" },
  { id: "detection", label: "Detection Output" },
  { id: "history", label: "History" },
  { id: "about", label: "About" },
  { id: "report", label: "Report" },
];

function Metric({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function ensureUserDoc(user) {
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      await setDoc(ref, {
        email: user.email,
        role: "user",
        createdAt: serverTimestamp(),
      });
    }

    return (await getDoc(ref)).data();
  }

  function friendlyError(code) {
    const map = {
      "auth/user-not-found": "No account found with that email.",
      "auth/wrong-password": "Incorrect password.",
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/email-already-in-use": "An account with this email already exists.",
      "auth/weak-password": "Password must be at least 6 characters.",
      "auth/invalid-email": "Please enter a valid email address.",
      "auth/popup-closed-by-user": "Google sign-in was cancelled.",
      "auth/too-many-requests": "Too many attempts. Please try again later.",
    };

    return map[code] || "Something went wrong. Please try again.";
  }

  async function handleEmailAuth(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const credential =
        mode === "login"
          ? await signInWithEmailAndPassword(auth, email, password)
          : await createUserWithEmailAndPassword(auth, email, password);

      const userData = await ensureUserDoc(credential.user);
      onAuth(credential.user, userData.role || "user");
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleAuth() {
    setError("");
    setLoading(true);

    try {
      const credential = await signInWithPopup(auth, googleProvider);
      const userData = await ensureUserDoc(credential.user);
      onAuth(credential.user, userData.role || "user");
    } catch (err) {
      setError(friendlyError(err.code));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="logo-mark">ML</div>
        <h1>{mode === "login" ? "Welcome Back" : "Create Account"}</h1>
        <p>
          {mode === "login"
            ? "Sign in to your PCB inspection account."
            : "Get started with PCB solder defect classification."}
        </p>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => {
              setMode("login");
              setError("");
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={mode === "signup" ? "active" : ""}
            onClick={() => {
              setMode("signup");
              setError("");
            }}
          >
            Create Account
          </button>
        </div>

        <form className="auth-form" onSubmit={handleEmailAuth}>
          <label>
            Email
            <input
              type="email"
              value={email}
              placeholder="you@example.com"
              autoComplete="email"
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          {error && <div className="error-text">{error}</div>}

          <button className="btn primary" type="submit" disabled={loading}>
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>

        <div className="divider">or</div>

        <button className="btn google" type="button" onClick={handleGoogleAuth} disabled={loading}>
          Continue with Google
        </button>
      </section>

      <section className="auth-hero">
        <h2>Machine Learning-Based PCB Solder Defect Classification</h2>
        <p>Image-based solder joint inspection for quality-control support.</p>
        <div className="hero-stat">
          <strong>94.2%</strong>
          <span>Model validation accuracy target/display</span>
        </div>
      </section>
    </main>
  );
}

function AdminDashboard({ currentResult, adminUid }) {
  const [metrics, setMetrics] = useState({ total: "—", defective: "—", mostCommon: "—" });
  const [users, setUsers] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const inspectionsRef = collection(db, "inspections");
      const [totalSnap, defectiveSnap, allSnap, usersSnap, reportsSnap] = await Promise.all([
        getCountFromServer(inspectionsRef),
        getCountFromServer(query(inspectionsRef, where("prediction", "==", "Defective"))),
        getDocs(inspectionsRef),
        getDocs(collection(db, "users")),
        getDocs(query(collection(db, "reports"), orderBy("timestamp", "desc"), limit(50))),
      ]);

      const frequency = {};
      allSnap.forEach((item) => {
        const defect = item.data().defect;
        if (defect && defect !== "No Defect") {
          frequency[defect] = (frequency[defect] || 0) + 1;
        }
      });

      const mostCommon = Object.keys(frequency).length
        ? Object.entries(frequency).sort((a, b) => b[1] - a[1])[0][0]
        : "N/A";

      setMetrics({
        total: totalSnap.data().count.toLocaleString(),
        defective: defectiveSnap.data().count.toLocaleString(),
        mostCommon,
      });

      setUsers(
        usersSnap.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((user) => user.id !== adminUid)
      );
      setReports(reportsSnap.docs.map((item) => ({ id: item.id, ...item.data() })));
    } catch (err) {
      setError(err.message || "Failed to load admin dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [adminUid]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void loadAdminData();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [loadAdminData, currentResult]);

  return (
    <section id="dashboard" className="section">
      <div className="section-head">
        <div>
          <h3>Admin Dashboard</h3>
          <p>System overview, user accounts, and submitted reports.</p>
        </div>
        <button className="btn" type="button" onClick={loadAdminData} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}

      <div className="metrics-grid">
        <Metric label="Total Inspections" value={metrics.total} />
        <Metric label="Defective Boards" value={metrics.defective} />
        <Metric label="Most Common Defect" value={metrics.mostCommon} />
      </div>

      <div className="admin-grid">
        <div className="admin-card">
          <h4>User Accounts</h4>
          {users.length === 0 ? (
            <p className="muted">No user accounts found.</p>
          ) : (
            <div className="mini-list">
              {users.map((user) => (
                <div key={user.id} className="mini-row">
                  <span>{user.email || user.id}</span>
                  <strong>{user.role || "user"}</strong>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="admin-card">
          <h4>Bug Reports</h4>
          {reports.length === 0 ? (
            <p className="muted">No bug reports submitted yet.</p>
          ) : (
            <div className="mini-list">
              {reports.map((report) => (
                <div key={report.id} className="mini-row stacked">
                  <span>{report.email || report.uid || "Anonymous"}</span>
                  <p>{report.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function PCBSolderDefectClassifier() {
  const [authUser, setAuthUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [activeSection, setActiveSection] = useState("home");
  const [imageSrc, setImageSrc] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState(EMPTY_RESULT);
  const [latestResult, setLatestResult] = useState(null);
  const [error, setError] = useState("");
  const [reportMsg, setReportMsg] = useState("");
  const [reportStatus, setReportStatus] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const role = userSnap.exists() ? userSnap.data().role || "user" : "user";

        setAuthUser(user);
        setUserRole(role);
        setActiveSection(role === "admin" ? "dashboard" : "home");
      } else {
        setAuthUser(null);
        setUserRole(null);
      }

      setAuthReady(true);
    });

    return unsubscribe;
  }, []);

  function handleAuth(user, role) {
    setAuthUser(user);
    setUserRole(role);
    setActiveSection(role === "admin" ? "dashboard" : "home");
  }

  async function handleLogout() {
    await signOut(auth);
    setAuthUser(null);
    setUserRole(null);
    setResult(EMPTY_RESULT);
    setImageSrc("");
    setImageFile(null);
    setReportMsg("");
    setReportStatus("");
    setLatestResult(null);
  }

  const loadLatestResult = useCallback(async () => {
    if (!authUser) return;

    try {
      const latestQuery = query(
        collection(db, "inspections"),
        where("uid", "==", authUser.uid),
        orderBy("timestamp", "desc"),
        limit(1)
      );
      const snap = await getDocs(latestQuery);

      if (!snap.empty) {
        setLatestResult({ id: snap.docs[0].id, ...snap.docs[0].data() });
      }
    } catch (err) {
      console.error("Failed to load latest result:", err);
    }
  }, [authUser]);

  useEffect(() => {
    if (activeSection !== "detection" || userRole === "admin") return undefined;

    const timerId = window.setTimeout(() => {
      void loadLatestResult();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [activeSection, loadLatestResult, userRole]);

  const navItems = useMemo(() => (userRole === "admin" ? ADMIN_NAV : USER_NAV), [userRole]);

  useEffect(() => {
    const onScroll = () => {
      const scrollY = window.scrollY + 180;
      let current = navItems[0]?.id || "home";

      navItems.forEach(({ id }) => {
        const element = document.getElementById(id);

        if (element && scrollY >= element.offsetTop && scrollY < element.offsetTop + element.offsetHeight) {
          current = id;
        }
      });

      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 10) {
        current = navItems[navItems.length - 1]?.id || current;
      }

      setActiveSection(current);
    };

    window.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onScroll);

    const frameId = window.requestAnimationFrame(onScroll);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [navItems]);

  function scrollToSection(id) {
    const element = document.getElementById(id);

    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    setActiveSection(id);
  }

  function handleImageUpload(event) {
    const file = event.target.files?.[0];

    if (!file) return;

    setImageFile(file);
    setError("");

    const reader = new FileReader();

    reader.onload = (readerEvent) => {
      setImageSrc(readerEvent.target?.result || "");
      setResult({
        ...EMPTY_RESULT,
        defect: "Image uploaded. Click Analyze Image.",
      });
    };

    reader.readAsDataURL(file);
  }

  async function analyzeImage() {
    if (!imageFile) {
      setError("Please upload an image before running analysis.");
      return;
    }

    if (!API_URL) {
      setError("VITE_API_URL is not configured.");
      return;
    }

    setIsAnalyzing(true);
    setError("");
    setResult({
      prediction: "Analyzing…",
      defect: "Processing image…",
      confidence: 0,
      recommendation: "",
      defects: [],
    });

    try {
      const formData = new FormData();
      formData.append("file", imageFile);

      const idToken = await authUser.getIdToken();
      const response = await fetch(`${API_URL}/predict`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || `Server error: ${response.status}`);
      }

      setResult(payload);
      setLatestResult({
        prediction: payload.prediction,
        defect: payload.defect,
        confidence: payload.confidence,
        recommendation: payload.recommendation,
        imageUrl: null,
        defects: payload.defects || [],
        modelVersion: payload.modelVersion,
        mock: payload.mock,
        detectionCount: payload.detectionCount,
        timestamp: new Date().toISOString(),
      });
      setActiveSection("detection");
    } catch (err) {
      setError(err.message || "Failed to connect to the analysis server.");
      setResult(EMPTY_RESULT);
    } finally {
      setIsAnalyzing(false);
    }
  }

  function resetDemo() {
    setImageSrc("");
    setImageFile(null);
    setResult(EMPTY_RESULT);
    setError("");
  }

  async function submitReport() {
    if (!reportMsg.trim()) {
      setReportStatus("Please describe the bug or error encountered.");
      return;
    }

    setReportStatus("Submitting…");

    try {
      await addDoc(collection(db, "reports"), {
        message: reportMsg.trim(),
        uid: authUser?.uid || null,
        email: authUser?.email || null,
        timestamp: serverTimestamp(),
      });

      setReportStatus("Report submitted successfully. Thank you.");
      setReportMsg("");
    } catch {
      setReportStatus("Failed to submit report. Please try again.");
    }
  }

  if (!authReady) {
    return <div className="loading-screen">Loading…</div>;
  }

  if (!authUser) {
    return <AuthScreen onAuth={handleAuth} />;
  }

  const isAdmin = userRole === "admin";
  const detectionResult = result.prediction !== "Waiting" ? result : latestResult || EMPTY_RESULT;
  const detectionImageSrc = imageSrc || latestResult?.imageUrl || "";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="logo-mark">ML</div>
          <div>
            <h1>PCB Solder Defect Classifier</h1>
            <p>ML-based solder joint inspection.</p>
          </div>
        </div>

        <nav className="side-nav">
          {navItems.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={activeSection === id ? "active" : ""}
              onClick={() => scrollToSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="profile-card">
          <div className="avatar">
            {(authUser.displayName || authUser.email || "?")[0].toUpperCase()}
          </div>
          <div>
            <strong>{authUser.displayName || authUser.email}</strong>
            <span>{isAdmin ? "Admin" : "User"}</span>
          </div>
        </div>

        <button className="btn logout" type="button" onClick={handleLogout}>
          Sign Out
        </button>
      </aside>

      <main className="content">
        {isAdmin && <AdminDashboard currentResult={result} adminUid={authUser.uid} />}

        {!isAdmin && (
          <section id="home" className="section hero-section">
            <span className="eyebrow">Machine Learning-Based Inspection System</span>
            <h2>Classify PCB solder defects from uploaded images.</h2>
            <p>
              Upload a PCB solder joint image and see the predicted defect class, confidence score,
              and bounding box location.
            </p>
            <div className="hero-actions">
              <button className="btn primary" type="button" onClick={() => scrollToSection("upload")}>
                Upload Image
              </button>
              <button className="btn" type="button" onClick={() => scrollToSection("detection")}>
                View Detection
              </button>
            </div>
            <div className="hero-stat compact">
              <strong>94.2%</strong>
              <span>Model validation accuracy target/display</span>
            </div>
          </section>
        )}

        {!isAdmin && (
          <section id="upload" className="section grid-two">
            <div className="panel">
              <div className="section-head">
                <div>
                  <h3>Upload PCB Image</h3>
                  <p>Upload a JPG or PNG image of a solder joint.</p>
                </div>
                <span className="pill">Input</span>
              </div>

              <label className="upload-box">
                <input type="file" accept="image/png,image/jpeg" onChange={handleImageUpload} />
                {imageSrc ? (
                  <img src={imageSrc} alt="Uploaded PCB preview" />
                ) : (
                  <div>
                    <strong>+</strong>
                    <p>Click or drag image here</p>
                    <span>Accepted: JPG, JPEG, PNG</span>
                  </div>
                )}
              </label>

              <div className="button-row">
                <button className="btn primary" type="button" onClick={analyzeImage} disabled={isAnalyzing}>
                  {isAnalyzing ? "Analyzing…" : "Analyze Image"}
                </button>
                <button className="btn" type="button" onClick={resetDemo}>
                  Reset
                </button>
              </div>

              {error && <div className="error-text">{error}</div>}
            </div>

            <div className="panel result-panel">
              <div className="section-head">
                <div>
                  <h3>Classification Result</h3>
                  <p>Model output appears after analysis.</p>
                </div>
                <span className="pill">Output</span>
              </div>

              <div className="result-main">
                <span>Prediction</span>
                <strong>{result.prediction}</strong>
                <p>{result.defect}</p>
              </div>

              <div className="confidence-card">
                <span>Confidence Score</span>
                <strong>{result.confidence}%</strong>
                <p>Model certainty</p>
              </div>

              {result.recommendation && <p className="recommendation">{result.recommendation}</p>}
            </div>
          </section>
        )}

        {!isAdmin && (
          <section id="detection" className="section">
            <div className="section-head">
              <div>
                <h3>Detection Output</h3>
                <p>
                  {result.prediction !== "Waiting"
                    ? "Current session result."
                    : "Showing your most recent inspection result."}
                </p>
              </div>
              <button className="btn" type="button" onClick={loadLatestResult}>
                Refresh Detection
              </button>
            </div>

            <div className="detection-layout">
              <div className="detection-canvas">
                {detectionImageSrc ? (
                  <>
                    <img src={detectionImageSrc} alt="Detection output" />
                    {(detectionResult.defects || []).map((defect) => (
                      <div
                        key={defect.id || `${defect.type}-${defect.x}-${defect.y}`}
                        className="bbox"
                        style={{
                          left: `${defect.x || 0}%`,
                          top: `${defect.y || 0}%`,
                          width: `${defect.width || 0}%`,
                          height: `${defect.height || 0}%`,
                        }}
                      >
                        <span>{defect.type || defect.label || detectionResult.defect}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="empty-state">
                    <strong>No detection yet</strong>
                    <p>Upload and analyze a PCB solder image to see results here.</p>
                  </div>
                )}
              </div>

              <div className="detection-details">
                <Metric label="Prediction" value={detectionResult.prediction} />
                <Metric label="Defect" value={detectionResult.defect} />
                <Metric label="Confidence" value={`${detectionResult.confidence ?? 0}%`} />
                <Metric label="Model" value={detectionResult.modelVersion || "—"} />
                <Metric label="Mock Result" value={detectionResult.mock ? "Yes" : "No"} />
                <Metric
                  label="Detected Boxes"
                  value={detectionResult.detectionCount ?? detectionResult.defects?.length ?? 0}
                />

                {detectionResult.recommendation && (
                  <div className="recommendation-box">
                    <h4>Recommendation</h4>
                    <p>{detectionResult.recommendation}</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {!isAdmin && <HistoryPanel authUser={authUser} apiUrl={API_URL} />}

        {!isAdmin && (
          <section id="about" className="section">
            <div className="section-head">
              <div>
                <h3>About the Project</h3>
                <p>What the system does and how it is limited.</p>
              </div>
              <span className="pill">About</span>
            </div>
            <p>
              This system uses image-based analysis to classify PCB solder joint images into defect
              categories such as Solder Bridge, Insufficient Solder, Excess Solder, Solder Spike,
              and No Defect. Images are processed by a Flask backend hosted in a Docker container,
              results are stored in Firebase Firestore, and the interface displays the model result
              with bounding-box visualization when detections are returned.
            </p>
          </section>
        )}

        {!isAdmin && (
          <section id="report" className="section">
            <div className="section-head">
              <div>
                <h3>Report a Bug</h3>
                <p>Describe any issues or errors encountered while using the system.</p>
              </div>
              <span className="pill">Bug Report</span>
            </div>

            <textarea
              className="report-box"
              value={reportMsg}
              placeholder="Describe the bug or error encountered…"
              onChange={(event) => setReportMsg(event.target.value)}
            />

            {reportStatus && <div className="report-status">{reportStatus}</div>}

            <button className="btn primary" type="button" onClick={submitReport}>
              Submit
            </button>
          </section>
        )}

        <div className="footer">Machine Learning-Based PCB Solder Defect Classification System</div>
      </main>
    </div>
  );
}