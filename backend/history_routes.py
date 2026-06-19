from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from firebase_admin import firestore
from flask import jsonify, request

MAX_HISTORY_RECORDS = 100
MAX_REMARKS_LENGTH = 500


def _serialize_timestamp(value: Any) -> str | None:
    """Convert Firestore timestamp-like values into frontend-friendly text."""
    if value is None:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()

    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return str(value)

    return str(value)


def _serialize_inspection(document_snapshot: Any) -> dict[str, Any]:
    data = document_snapshot.to_dict() or {}

    defects = data.get("defects") or []
    detection_count = data.get("detectionCount")

    if detection_count is None:
        detection_count = len(defects) if isinstance(defects, list) else 0

    return {
        "id": document_snapshot.id,
        "timestamp": _serialize_timestamp(data.get("timestamp")),
        "prediction": data.get("prediction", "—"),
        "defect": data.get("defect", "—"),
        "confidence": data.get("confidence"),
        "modelVersion": data.get("modelVersion", "—"),
        "mock": data.get("mock", False),
        "detectionCount": detection_count,
        "defects": defects,
        "remarks": data.get("remarks", ""),
        "remarksUpdatedAt": _serialize_timestamp(data.get("remarksUpdatedAt")),
    }


def _json_error(error: str, message: str, status_code: int):
    return jsonify({"error": error, "message": message}), status_code


def register_history_routes(app, authenticate_request):
    """Register production-like history routes on the Flask app.

    The frontend never writes inspection remarks directly to Firestore.
    It calls these backend routes instead. The backend verifies the Firebase
    token and checks ownership before returning or updating records.
    """

    @app.get("/inspections")
    def list_user_inspections():
        decoded_token, auth_error = authenticate_request()

        if auth_error:
            return auth_error

        uid = decoded_token.get("uid")

        if not uid:
            return _json_error(
                "missing_uid",
                "The authenticated token does not contain a user id.",
                401,
            )

        try:
            query = (
                firestore.client()
                .collection("inspections")
                .where("uid", "==", uid)
                .order_by("timestamp", direction=firestore.Query.DESCENDING)
                .limit(MAX_HISTORY_RECORDS)
            )

            records = [_serialize_inspection(snapshot) for snapshot in query.stream()]

            return jsonify({"records": records})
        except Exception as exc:
            app.logger.exception("Could not load inspection history: %s", exc)
            return _json_error(
                "history_unavailable",
                "The inspection history could not be loaded.",
                503,
            )

    @app.patch("/inspections/<inspection_id>/remarks")
    def update_inspection_remarks(inspection_id: str):
        decoded_token, auth_error = authenticate_request()

        if auth_error:
            return auth_error

        uid = decoded_token.get("uid")

        if not uid:
            return _json_error(
                "missing_uid",
                "The authenticated token does not contain a user id.",
                401,
            )

        payload = request.get_json(silent=True) or {}
        remarks = payload.get("remarks", "")

        if not isinstance(remarks, str):
            return _json_error(
                "invalid_remarks",
                "Remarks must be plain text.",
                400,
            )

        remarks = remarks.strip()

        if len(remarks) > MAX_REMARKS_LENGTH:
            return _json_error(
                "remarks_too_long",
                f"Remarks must not exceed {MAX_REMARKS_LENGTH} characters.",
                400,
            )

        try:
            document_ref = firestore.client().collection("inspections").document(inspection_id)
            document_snapshot = document_ref.get()

            if not document_snapshot.exists:
                return _json_error(
                    "inspection_not_found",
                    "The inspection record was not found.",
                    404,
                )

            inspection = document_snapshot.to_dict() or {}

            if inspection.get("uid") != uid:
                return _json_error(
                    "forbidden",
                    "You can only update remarks for your own inspection records.",
                    403,
                )

            update_payload = {
                "remarks": remarks,
                "remarksUpdatedAt": firestore.SERVER_TIMESTAMP,
            }

            document_ref.update(update_payload)

            return jsonify(
                {
                    "success": True,
                    "inspectionId": inspection_id,
                    "remarks": remarks,
                    "remarksUpdatedAt": datetime.now(timezone.utc).isoformat(),
                }
            )
        except Exception as exc:
            app.logger.exception("Could not update inspection remarks: %s", exc)
            return _json_error(
                "remarks_unavailable",
                "The remarks could not be saved.",
                503,
            )