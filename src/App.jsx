/**
 * PCB Solder Defect Classifier — with Firebase Auth (Email + Google OAuth)
 *
 * Environment variables required (.env):
 *   VITE_API_URL
 *   VITE_FIREBASE_API_KEY
 *   VITE_FIREBASE_AUTH_DOMAIN
 *   VITE_FIREBASE_PROJECT_ID
 *   VITE_FIREBASE_APP_ID
 *   VITE_FIREBASE_STORAGE_BUCKET   ← e.g. your-project.appspot.com
 */

import { useEffect, useState, useCallback } from "react";
import HistoryPanel from "./HistoryPanel.jsx";
import { initializeApp } from "firebase/app";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore, collection, addDoc, setDoc, getDoc, doc,
  serverTimestamp, getCountFromServer, query, where, getDocs, orderBy, limit,
} from "firebase/firestore";

const firebaseApp = initializeApp({
  apiKey:        import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:     import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId:         import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
});
const db        = getFirestore(firebaseApp);
const auth      = getAuth(firebaseApp);
const gProvider = new GoogleAuthProvider();
const API_URL   = import.meta.env.VITE_API_URL;

const EMPTY_RESULT = {
  prediction: "Waiting",
  defect: "Upload an image to begin classification.",
  confidence: 0,
  recommendation: "Recommendation will appear after the image is analyzed.",
  defects: [],
};

// ── Nav definitions ───────────────────────────────────────────────────────────
const ADMIN_NAV = [
  { id: "dashboard", label: "Dashboard" },
];
const USER_NAV = [
  { id: "home",      label: "Home" },
  { id: "upload",    label: "Upload" },
  { id: "detection", label: "Detection Output" },
  { id: "history",   label: "History" },
  { id: "about",     label: "About" },
  { id: "report",    label: "Report" },
];

// ── Small reusable components ─────────────────────────────────────────────────
function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}

function DetectionItem({ label, value }) {
  return (
    <div className="detection-item">
      <h4>{label}</h4>
      <p className="small">{String(value)}</p>
    </div>
  );
}

// ── Auth Screen ───────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode]         = useState("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  async function ensureUserDoc(user) {
    const ref  = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { email: user.email, role: "user", createdAt: serverTimestamp() });
    }
    return (await getDoc(ref)).data();
  }

  function friendlyError(code) {
    const map = {
      "auth/user-not-found":       "No account found with that email.",
      "auth/wrong-password":       "Incorrect password.",
      "auth/invalid-credential":   "Incorrect email or password.",
      "auth/email-already-in-use": "An account with this email already exists.",
      "auth/weak-password":        "Password must be at least 6 characters.",
      "auth/invalid-email":        "Please enter a valid email address.",
      "auth/popup-closed-by-user": "Google sign-in was cancelled.",
      "auth/too-many-requests":    "Too many attempts. Please try again later.",
    };
    return map[code] || "Something went wrong. Please try again.";
  }

  async function handleEmailAuth(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const cred = mode === "login"
        ? await signInWithEmailAndPassword(auth, email, password)
        : await createUserWithEmailAndPassword(auth, email, password);
      const userData = await ensureUserDoc(cred.user);
      onAuth(cred.user, userData.role || "user");
    } catch (err) { setError(friendlyError(err.code)); }
    finally { setLoading(false); }
  }

  async function handleGoogle() {
    setError(""); setLoading(true);
    try {
      const cred     = await signInWithPopup(auth, gProvider);
      const userData = await ensureUserDoc(cred.user);
      onAuth(cred.user, userData.role || "user");
    } catch (err) { setError(friendlyError(err.code)); }
    finally { setLoading(false); }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-form-panel">
          <div className="auth-brand-mark">ML</div>
          <h1 className="auth-title">
            {mode === "login" ? "Welcome Back" : "Create Account"}
          </h1>
          <p className="auth-subtitle">
            {mode === "login"
              ? "Sign in to your PCB inspection account."
              : "Get started with PCB solder defect classification."}
          </p>

          <div className="auth-tabs">
            <button className={`auth-tab${mode === "login" ? " active" : ""}`}
              onClick={() => { setMode("login"); setError(""); }}>Sign In</button>
            <button className={`auth-tab${mode === "signup" ? " active" : ""}`}
              onClick={() => { setMode("signup"); setError(""); }}>Create Account</button>
          </div>

          <form onSubmit={handleEmailAuth} className="auth-fields">
            <div className="field-group">
              <label>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required autoComplete="email" />
            </div>
            <div className="field-group">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                required autoComplete={mode === "login" ? "current-password" : "new-password"} />
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button className="btn auth-submit" type="submit" disabled={loading}>
              {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>

          <div className="auth-divider"><span>or</span></div>

          <button className="btn-google" onClick={handleGoogle} disabled={loading}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>

          <p className="auth-footer-note">
            Machine Learning-Based PCB Solder Defect Classification
          </p>
        </div>

        <div className="auth-image-panel">
          <div className="auth-image-overlay">
            <div className="auth-image-stat">
              <strong>94.2%</strong>
              <span>Model validation accuracy</span>
            </div>
            <p className="auth-image-caption">
              PCB solder joint inspection for quality control.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Admin Dashboard ───────────────────────────────────────────────────────────
function AdminDashboard({ currentResult, adminUid }) {
  const [tab, setTab]               = useState("metrics");
  const [metrics, setMetrics]       = useState({ total: null, defective: null, mostCommon: null });
  const [users, setUsers]           = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [userInspections, setUserInspections] = useState([]);
  const [inspLoading, setInspLoading] = useState(false);
  const [reports, setReports]       = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  useEffect(() => {
    async function loadMetrics() {
      try {
        const col = collection(db, "inspections");
        const [totalSnap, defectiveSnap, allSnap] = await Promise.all([
          getCountFromServer(col),
          getCountFromServer(query(col, where("prediction", "==", "Defective"))),
          getDocs(col),
        ]);
        const freq = {};
        allSnap.forEach((d) => {
          const v = d.data().defect;
          if (v && v !== "No Defect") freq[v] = (freq[v] || 0) + 1;
        });
        const mostCommon = Object.keys(freq).length
          ? Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0] : "N/A";
        setMetrics({
          total:     totalSnap.data().count.toLocaleString(),
          defective: defectiveSnap.data().count.toLocaleString(),
          mostCommon,
        });
      } catch { /* silently fail */ }
    }
    loadMetrics();
  }, [currentResult]);

  useEffect(() => {
    if (tab !== "users") return;
    async function loadUsers() {
      setUsersLoading(true);
      setUsersError("");
      try {
        const snap = await getDocs(collection(db, "users"));
        const list = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(u => u.id !== adminUid);
        setUsers(list);
      } catch (e) {
        console.error("loadUsers error:", e);
        if (e.code === "permission-denied") {
          setUsersError(
            "Permission denied. Update your Firestore rules to allow admin reads on the users collection."
          );
        } else {
          setUsersError(`Failed to load users: ${e.message}`);
        }
      } finally { setUsersLoading(false); }
    }
    loadUsers();
  }, [tab, adminUid]);

  useEffect(() => {
    if (!selectedUser) return;
    async function loadInspections() {
      setInspLoading(true);
      try {
        const q = query(
          collection(db, "inspections"),
          where("uid", "==", selectedUser.id),
          orderBy("timestamp", "desc"),
          limit(50)
        );
        const snap = await getDocs(q);
        setUserInspections(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error(e); }
      finally { setInspLoading(false); }
    }
    loadInspections();
  }, [selectedUser]);

  useEffect(() => {
    if (tab !== "reports") return;
    async function loadReports() {
      setReportsLoading(true);
      try {
        const q = query(collection(db, "reports"), orderBy("timestamp", "desc"), limit(100));
        const snap = await getDocs(q);
        setReports(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) { console.error(e); }
      finally { setReportsLoading(false); }
    }
    loadReports();
  }, [tab]);

  function fmtDate(ts) {
    if (!ts?.toDate) return "—";
    return ts.toDate().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  }

  function fmtDateTime(ts) {
    if (!ts?.toDate) return "—";
    return ts.toDate().toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <section className="card admin-dashboard" id="dashboard">
      <div className="admin-tabs-header">
        <div>
          <h3>Admin Dashboard</h3>
          <p>System overview, user accounts, and submitted reports.</p>
        </div>
        <div className="admin-tab-row">
          {[
            { key: "metrics", label: "Metrics" },
            { key: "users",   label: "User Accounts" },
            { key: "reports", label: "Bug Reports" },
          ].map(({ key, label }) => (
            <button key={key}
              className={`admin-tab-btn${tab === key ? " active" : ""}`}
              onClick={() => { setTab(key); setSelectedUser(null); }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "metrics" && (
        <div>
          <div className="grid-3" style={{ marginTop: 20 }}>
            <Metric label="Total Images Analyzed"     value={metrics.total} />
            <Metric label="Defective Joints Detected" value={metrics.defective} />
            <Metric label="Most Common Defect"        value={metrics.mostCommon} />
          </div>
        </div>
      )}

      {tab === "users" && !selectedUser && (
        <div style={{ marginTop: 20 }}>
          {usersLoading ? (
            <div className="history-empty">Loading accounts…</div>
          ) : usersError ? (
            <div className="history-empty" style={{ color: "#c0392b", fontSize: 13, padding: "24px 0" }}>
              ⚠️ {usersError}
            </div>
          ) : users.length === 0 ? (
            <div className="history-empty">
              No user accounts found.
              <p className="small" style={{ marginTop: 8 }}>
                Make sure users have signed in at least once so their account doc is created in Firestore.
              </p>
            </div>
          ) : (
            <table className="history-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td>{u.email || "—"}</td>
                    <td>
                      <span className={`pill ${u.role === "admin" ? "pill-admin" : "good"}`}>
                        {u.role || "user"}
                      </span>
                    </td>
                    <td>{fmtDate(u.createdAt)}</td>
                    <td>
                      {u.role !== "admin" && (
                        <button className="btn-link"
                          onClick={() => { setSelectedUser(u); setUserInspections([]); }}>
                          View Uploads →
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "users" && selectedUser && (
        <div style={{ marginTop: 20 }}>
          <div className="drilldown-header">
            <button className="btn outline btn-sm" onClick={() => setSelectedUser(null)}>
              ← Back to Users
            </button>
            <div>
              <strong>{selectedUser.email}</strong>
              <span className="small" style={{ marginLeft: 10 }}>Inspection records</span>
            </div>
          </div>

          {inspLoading ? (
            <div className="history-empty">Loading inspections…</div>
          ) : userInspections.length === 0 ? (
            <div className="history-empty">This user has no inspection records yet.</div>
          ) : (
            <table className="history-table" style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Prediction</th>
                  <th>Defect</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {userInspections.map(h => (
                  <tr key={h.id}>
                    <td>{fmtDateTime(h.timestamp)}</td>
                    <td>
                      <span className={`pill ${h.prediction === "Good" ? "good" : "bad"}`}>
                        {h.prediction}
                      </span>
                    </td>
                    <td>{h.defect}</td>
                    <td>{h.confidence != null ? `${h.confidence}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "reports" && (
        <div style={{ marginTop: 20 }}>
          {reportsLoading ? (
            <div className="history-empty">Loading reports…</div>
          ) : reports.length === 0 ? (
            <div className="history-empty">No bug reports submitted yet.</div>
          ) : (
            <div className="reports-list">
              {reports.map(r => (
                <div key={r.id} className="report-card">
                  <div className="report-card-meta">
                    <span className="small">{r.email || r.uid || "Anonymous"}</span>
                    <span className="small muted">{fmtDateTime(r.timestamp)}</span>
                  </div>
                  <p className="report-card-body">{r.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function PCBSolderDefectClassifier() {
  const [authUser, setAuthUser]         = useState(null);
  const [userRole, setUserRole]         = useState(null);
  const [authReady, setAuthReady]       = useState(false);
  const [imageSrc, setImageSrc]         = useState("");
  const [imageFile, setImageFile]       = useState(null);
  const [isAnalyzing, setIsAnalyzing]   = useState(false);
  const [activeSection, setActiveSection] = useState("home");
  const [result, setResult]             = useState(EMPTY_RESULT);
  const [latestResult, setLatestResult] = useState(null);
  const [error, setError]               = useState("");
  const [reportMsg, setReportMsg]       = useState("");
  const [reportStatus, setReportStatus] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const snap = await getDoc(doc(db, "users", user.uid));
        const role = snap.exists() ? (snap.data().role || "user") : "user";
        setAuthUser(user);
        setUserRole(role);
        setActiveSection(role === "admin" ? "dashboard" : "home");
      } else {
        setAuthUser(null);
        setUserRole(null);
      }
      setAuthReady(true);
    });
    return unsub;
  }, []);

  function handleAuth(user, role) {
    setAuthUser(user);
    setUserRole(role);
    setActiveSection(role === "admin" ? "dashboard" : "home");
  }

  async function handleLogout() {
    await signOut(auth);
    setAuthUser(null); setUserRole(null);
    setResult(EMPTY_RESULT); setImageSrc(""); setImageFile(null);
     setReportMsg(""); setReportStatus("");
    setLatestResult(null);
  }

  const loadLatestResult = useCallback(async () => {
    if (!authUser) return;
    try {
      const q = query(
        collection(db, "inspections"),
        where("uid", "==", authUser.uid),
        orderBy("timestamp", "desc"),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        setLatestResult({ id: snap.docs[0].id, ...snap.docs[0].data() });
      }
    } catch (e) { console.error(e); }
  }, [authUser]); 

    useEffect(() => {
      let cancelled = false;

      const loadResult = async () => {
        await Promise.resolve();

        if (!cancelled) {
          await loadLatestResult();
        }
      };

      if (activeSection === "detection" && userRole !== "admin") {
        void loadResult();
      }

      return () => {
        cancelled = true;
      };
    }, [activeSection, loadLatestResult, userRole]);

  useEffect(() => {
    const navItems = userRole === "admin" ? ADMIN_NAV : USER_NAV;
    const onScroll = () => {
      const scrollY = window.scrollY + 180;
      let current = navItems[0]?.id || "home";
      navItems.forEach(({ id }) => {
        const el = document.getElementById(id);
        if (el && scrollY >= el.offsetTop && scrollY < el.offsetTop + el.offsetHeight) current = id;
      });
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 10)
        current = navItems[navItems.length - 1]?.id || current;
      setActiveSection(current);
    };
    window.addEventListener("scroll", onScroll);
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, [userRole]);

  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImageSrc(ev.target?.result || "");
      setResult({ ...EMPTY_RESULT, defect: "Image uploaded. Click Analyze Image." });
      setError("");
    };
    reader.readAsDataURL(file);
  }

  // ── ONLY THIS FUNCTION CHANGED ────────────────────────────────────────────
  async function analyzeImage() {
    if (!imageFile) { setError("Please upload an image before running analysis."); return; }
    setIsAnalyzing(true); setError("");
    setResult({ prediction: "Analyzing…", defect: "Processing image…", confidence: 0, recommendation: "", defects: [] });
    try {
      if (!API_URL) {
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
    });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      setResult(data); setLatestResult({
        prediction:    data.prediction,
        defect:        data.defect,
        confidence:    data.confidence,
        recommendation: data.recommendation,
        imageUrl:      null,
        defects:       data.defects || [],
      });

    } catch (err) {
      setError(err.message || "Failed to connect to the analysis server.");
      setResult(EMPTY_RESULT);
    } finally { setIsAnalyzing(false); }
  }
  // ─────────────────────────────────────────────────────────────────────────

  function resetDemo() {
    setImageSrc(""); setImageFile(null); setResult(EMPTY_RESULT); setError("");
  }

  async function submitReport() {
    if (!reportMsg.trim()) { setReportStatus("Please describe the bug or error encountered."); return; }
    setReportStatus("Submitting…");
    try {
      await addDoc(collection(db, "reports"), {
        message:   reportMsg.trim(),
        uid:       authUser?.uid || null,
        email:     authUser?.email || null,
        timestamp: serverTimestamp(),
      });
      setReportStatus("Report submitted successfully. Thank you.");
      setReportMsg("");
    } catch { setReportStatus("Failed to submit report. Please try again."); }
  }

  if (!authReady) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#fff" }}>
        <div style={{ color: "#666", fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (!authUser) return <AuthScreen onAuth={handleAuth} />;

  const isAdmin  = userRole === "admin";
  const navItems = isAdmin ? ADMIN_NAV : USER_NAV;

  const detectionResult = result.prediction !== "Waiting" ? result : (latestResult || EMPTY_RESULT);
  const detectionImageSrc = imageSrc || latestResult?.imageUrl || "";

  return (
    <div className="app">
      <aside>
        <div className="brand">
          <div className="brand-mark">ML</div>
          <h1>PCB Solder Defect Classifier</h1>
          <p>ML-based solder joint inspection.</p>
        </div>
        <nav>
          {navItems.map(({ id, label }) => (
            <a key={id} href={`#${id}`} className={activeSection === id ? "active" : ""}>{label}</a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">
              {(authUser.displayName || authUser.email || "?")[0].toUpperCase()}
            </div>
            <div className="user-chip-info">
              <strong>{authUser.displayName || authUser.email}</strong>
              <div className={`role-badge${isAdmin ? "" : " user"}`}>{isAdmin ? "Admin" : "User"}</div>
            </div>
          </div>
          <button className="btn-logout" onClick={handleLogout}>Sign Out</button>
        </div>
      </aside>

      <main>
        {/* ── Admin: single Dashboard section ── */}
        {isAdmin && (
          <AdminDashboard currentResult={result} adminUid={authUser.uid} />
        )}

        {/* ── User: Home ── */}
        {!isAdmin && (
          <section className="hero" id="home">
            <div>
              <span className="eyebrow">Machine Learning-Based Inspection System</span>
              <h2>Classify PCB solder defects from uploaded images.</h2>
              <p>Upload a PCB solder joint image and see the predicted defect class, confidence score, and bounding box location.</p>
              <div className="hero-actions">
                <a className="btn light" href="#upload">Upload Image</a>
                <a className="btn light" href="#detection">View Detection</a>
              </div>
            </div>
            <div className="hero-stat">
              <strong>94.2%</strong>
              <span>Model validation accuracy</span>
            </div>
          </section>
        )}

        {/* ── User: Upload ── */}
        {!isAdmin && (
          <section className="grid-2" id="upload">
            <div className="card">
              <div className="card-header">
                <div><h3>Upload PCB Image</h3><p>Upload a JPG or PNG image of a solder joint.</p></div>
                <span className="badge">Input</span>
              </div>
              <label className="upload-box" htmlFor="imageInput">
                {imageSrc
                  ? <img src={imageSrc} alt="Uploaded PCB preview" />
                  : <div><div className="upload-icon">+</div><strong>Click or drag image here</strong><p className="small">Accepted: JPG, JPEG, PNG</p></div>
                }
              </label>
              <input id="imageInput" type="file" accept="image/png,image/jpeg" onChange={handleImageUpload} />
              <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button className="btn" onClick={analyzeImage} disabled={isAnalyzing || !imageSrc}>
                  {isAnalyzing ? "Analyzing…" : "Analyze Image"}
                </button>
                <button className="btn outline" onClick={resetDemo}>Reset</button>
              </div>
              {error && <p className="error-msg">{error}</p>}
            </div>

            <div className="card">
              <div className="card-header">
                <div><h3>Classification Result</h3><p>Model output appears after analysis.</p></div>
                <span className="badge filled">Output</span>
              </div>
              <div className="result-box">
                <div className="result-label">Prediction</div>
                <div className="result-main">{result.prediction}</div>
                <p>{result.defect}</p>
                <div style={{ marginTop: 18 }}>
                  <div className="result-label">Confidence Score</div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    <strong>{result.confidence}%</strong>
                    <span className="small">Model certainty</span>
                  </div>
                  <div className="confidence-bar">
                    <div className="confidence-fill" style={{ width: `${result.confidence}%` }} />
                  </div>
                </div>
                <div className="recommendation">{result.recommendation}</div>
              </div>
            </div>
          </section>
        )}

        {/* ── User: Detection Output ── */}
        {!isAdmin && (
          <section className="card" id="detection">
            <div className="card-header">
              <div>
                <h3>Detection Output</h3>
                <p>
                  {result.prediction !== "Waiting"
                    ? "Current session result."
                    : "Showing your most recent inspection result."}
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button className="btn outline btn-sm" onClick={loadLatestResult}>Refresh</button>
                <span className="badge">Detection</span>
              </div>
            </div>
            <div className="detection-layout">
              <div className="detection-view">
                {detectionImageSrc ? (
                  <>
                    <img src={detectionImageSrc} alt="PCB solder defect detection view" />
                    {(detectionResult.defects || []).map((d) => (
                      <div key={d.id} className="defect-box"
                        style={{ left: `${d.x}%`, top: `${d.y}%`, width: `${d.width}%`, height: `${d.height}%` }}>
                        <span className="defect-box-label">{d.type}</span>
                      </div>
                    ))}
                  </>
                ) : (
                  <div className="detection-empty">
                    <strong>No detection yet</strong>
                    <p className="small">Upload and analyze a PCB solder image to see results here.</p>
                  </div>
                )}
              </div>
              <div className="detection-list">
                <DetectionItem label="Detected Class"    value={detectionResult.defect} />
                <DetectionItem label="Defect Count"      value={(detectionResult.defects || []).length} />
                <DetectionItem label="Inspection Status" value={detectionResult.prediction} />
                <DetectionItem label="Confidence"        value={detectionResult.confidence ? `${detectionResult.confidence}%` : "—"} />
                {detectionResult.recommendation && (
                  <div className="detection-item">
                    <h4>Recommendation</h4>
                    <p className="small">{detectionResult.recommendation}</p>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── User: History ── */}
        {!isAdmin && (
          <HistoryPanel authUser={authUser} apiUrl={API_URL} />
        )}


        {/* ── User: About ── */}
        {!isAdmin && (
          <section className="card" id="about">
            <h3>About the Project</h3>
            <p style={{ marginTop: 12 }}>
              This system uses a trained convolutional neural network to classify PCB solder
              joint images into defect categories including Solder Bridge, Insufficient Solder,
              Excess Solder, Solder Spike, and No Defect. Images are processed by a Flask
              backend hosted in a Docker container, results are stored in Firebase Firestore,
              and the dashboard metrics are derived from live inspection history.
            </p>
          </section>
        )}

        {/* ── User: Report ── */}
        {!isAdmin && (
          <section className="card" id="report">
            <div className="card-header">
              <div><h3>Report a Bug</h3><p>Describe any issues or errors encountered while using the system.</p></div>
              <span className="badge">Bug Report</span>
            </div>
            <div className="report-layout">
              <div>
                <textarea className="report-field" value={reportMsg}
                  onChange={(e) => setReportMsg(e.target.value)}
                  placeholder="Describe the bug or error encountered…" />
                {reportStatus && <div className="report-status">{reportStatus}</div>}
              </div>
              <button className="btn" onClick={submitReport}>Submit</button>
            </div>
          </section>
        )}

        <div className="footer">Machine Learning-Based PCB Solder Defect Classification System</div>
      </main>
    </div>
  );
}