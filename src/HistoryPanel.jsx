import { useCallback, useEffect, useMemo, useState } from "react";

function formatDateTime(value) {
  if (!value) return "—";

  if (typeof value === "string") {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleString("en-PH", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    return value;
  }

  if (typeof value === "object" && value.seconds) {
    return new Date(value.seconds * 1000).toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return "—";
}

function formatConfidence(value) {
  if (value === null || value === undefined || value === "") return "—";

  const numberValue = Number(value);

  if (Number.isNaN(numberValue)) return "—";

  return `${numberValue.toFixed(2).replace(/\.00$/, "")}%`;
}

export default function HistoryPanel({ authUser, apiUrl }) {
  const [records, setRecords] = useState([]);
  const [remarksDrafts, setRemarksDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const canLoad = useMemo(() => Boolean(authUser && apiUrl), [authUser, apiUrl]);

  const loadHistory = useCallback(async () => {
    if (!canLoad) {
      setError("The user session or backend API URL is not ready.");
      return;
    }

    setLoading(true);
    setError("");
    setStatus("");

    try {
      const token = await authUser.getIdToken();

      const response = await fetch(`${apiUrl}/inspections`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || `Failed to load history: ${response.status}`);
      }

      const loadedRecords = payload.records || [];
      const nextDrafts = {};

      loadedRecords.forEach((record) => {
        nextDrafts[record.id] = record.remarks || "";
      });

      setRecords(loadedRecords);
      setRemarksDrafts(nextDrafts);
    } catch (err) {
      setError(err.message || "Failed to load inspection history.");
    } finally {
      setLoading(false);
    }
  }, [apiUrl, authUser, canLoad]);

  useEffect(() => {
    if (!canLoad) return undefined;

    const timerId = window.setTimeout(() => {
      void loadHistory();
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [canLoad, loadHistory]);

  async function saveRemarks(recordId) {
    const remarks = remarksDrafts[recordId] || "";

    setSavingId(recordId);
    setError("");
    setStatus("");

    try {
      const token = await authUser.getIdToken();

      const response = await fetch(`${apiUrl}/inspections/${recordId}/remarks`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ remarks }),
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || `Failed to save remarks: ${response.status}`);
      }

      setRecords((current) =>
        current.map((record) =>
          record.id === recordId
            ? {
                ...record,
                remarks: payload.remarks,
                remarksUpdatedAt: payload.remarksUpdatedAt || record.remarksUpdatedAt,
              }
            : record
        )
      );

      setStatus("Remarks saved successfully.");
    } catch (err) {
      setError(err.message || "Failed to save remarks.");
    } finally {
      setSavingId("");
    }
  }

  return (
    <section id="history" className="section history-section">
      <div className="section-head">
        <div>
          <h3>Inspection History</h3>
          <p>View your previous PCB analyses and add notes or remarks per record.</p>
        </div>
        <span className="pill">History</span>
      </div>

      <div className="history-toolbar">
        <button className="btn" type="button" onClick={loadHistory} disabled={loading}>
          {loading ? "Loading…" : "Refresh History"}
        </button>
        <span className="history-count">{records.length} record(s)</span>
      </div>

      {error && <div className="error-text">{error}</div>}
      {status && <div className="report-status">{status}</div>}

      {loading ? (
        <div className="empty-state">Loading your inspection records…</div>
      ) : records.length === 0 ? (
        <div className="empty-state">
          <strong>No inspection records yet.</strong>
          <p>Analyze a PCB image first, then return to this History tab.</p>
        </div>
      ) : (
        <div className="history-table-wrap">
          <table className="history-table">
            <thead>
              <tr>
                <th>Date and Time</th>
                <th>Prediction</th>
                <th>Defect</th>
                <th>Confidence</th>
                <th>Model</th>
                <th>Detections</th>
                <th>Remarks</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td>{formatDateTime(record.timestamp)}</td>
                  <td>{record.prediction || "—"}</td>
                  <td>{record.defect || "—"}</td>
                  <td>{formatConfidence(record.confidence)}</td>
                  <td>{record.modelVersion || "—"}</td>
                  <td>{record.detectionCount ?? record.defects?.length ?? 0}</td>
                  <td>
                    <textarea
                      className="remarks-input"
                      value={remarksDrafts[record.id] || ""}
                      maxLength={500}
                      placeholder="Add note or remark…"
                      onChange={(event) =>
                        setRemarksDrafts((current) => ({
                          ...current,
                          [record.id]: event.target.value,
                        }))
                      }
                    />
                    <div className="remarks-meta">
                      {(remarksDrafts[record.id] || "").length}/500 characters
                    </div>
                  </td>
                  <td>
                    <button
                      className="btn btn-small"
                      type="button"
                      onClick={() => saveRemarks(record.id)}
                      disabled={savingId === record.id}
                    >
                      {savingId === record.id ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}