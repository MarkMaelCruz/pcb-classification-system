from datetime import datetime, timezone

from flask import Flask

import history_routes
from history_routes import register_history_routes


class FakeSnapshot:
    def __init__(self, document_id, data, exists=True):
        self.id = document_id
        self._data = data
        self.exists = exists

    def to_dict(self):
        return self._data


class FakeDocumentRef:
    def __init__(self, snapshot):
        self.snapshot = snapshot
        self.updated = None

    def get(self):
        return self.snapshot

    def update(self, payload):
        self.updated = payload
        self.snapshot._data.update(payload)


class FakeQuery:
    def __init__(self, snapshots):
        self.snapshots = snapshots
        self.uid = None

    def where(self, field, operator, value):
        assert field == "uid"
        assert operator == "=="
        self.uid = value
        return self

    def order_by(self, *_args, **_kwargs):
        return self

    def limit(self, _limit):
        return self

    def stream(self):
        return [snapshot for snapshot in self.snapshots if snapshot.to_dict().get("uid") == self.uid]


class FakeCollection:
    def __init__(self, snapshots):
        self.snapshots = snapshots
        self.document_refs = {
            snapshot.id: FakeDocumentRef(snapshot) for snapshot in snapshots
        }

    def where(self, *args, **kwargs):
        return FakeQuery(self.snapshots).where(*args, **kwargs)

    def document(self, document_id):
        return self.document_refs.get(
            document_id,
            FakeDocumentRef(FakeSnapshot(document_id, {}, exists=False)),
        )


class FakeFirestoreClient:
    def __init__(self, snapshots):
        self.collection_obj = FakeCollection(snapshots)

    def collection(self, name):
        assert name == "inspections"
        return self.collection_obj


def create_test_app(fake_client, uid="user-1"):
    app = Flask(__name__)

    def fake_authenticate_request():
        return {"uid": uid, "email": "user@example.com"}, None

    register_history_routes(app, fake_authenticate_request)
    return app


def test_get_inspections_returns_only_current_user(monkeypatch):
    snapshots = [
        FakeSnapshot(
            "doc-1",
            {
                "uid": "user-1",
                "prediction": "Defective",
                "defect": "Excess Solder",
                "confidence": 73.87,
                "modelVersion": "hf-yolo-test",
                "timestamp": datetime(2026, 6, 18, 10, 0, tzinfo=timezone.utc),
                "detectionCount": 1,
                "remarks": "Needs checking.",
            },
        ),
        FakeSnapshot(
            "doc-2",
            {
                "uid": "other-user",
                "prediction": "No Defect",
                "defect": "No Defect",
                "confidence": 0,
            },
        ),
    ]
    fake_client = FakeFirestoreClient(snapshots)
    monkeypatch.setattr(history_routes.firestore, "client", lambda: fake_client)

    app = create_test_app(fake_client)
    response = app.test_client().get("/inspections")

    assert response.status_code == 200
    body = response.get_json()
    assert len(body["records"]) == 1
    assert body["records"][0]["id"] == "doc-1"
    assert body["records"][0]["defect"] == "Excess Solder"
    assert body["records"][0]["remarks"] == "Needs checking."


def test_patch_remarks_updates_only_owned_record(monkeypatch):
    snapshots = [
        FakeSnapshot(
            "doc-1",
            {
                "uid": "user-1",
                "prediction": "Defective",
                "defect": "Excess Solder",
                "confidence": 73.87,
            },
        )
    ]
    fake_client = FakeFirestoreClient(snapshots)
    monkeypatch.setattr(history_routes.firestore, "client", lambda: fake_client)
    monkeypatch.setattr(history_routes.firestore, "SERVER_TIMESTAMP", "SERVER_TIMESTAMP")

    app = create_test_app(fake_client)
    response = app.test_client().patch(
        "/inspections/doc-1/remarks",
        json={"remarks": "Needs visual confirmation."},
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["success"] is True
    assert body["remarks"] == "Needs visual confirmation."

    document_ref = fake_client.collection_obj.document_refs["doc-1"]
    assert document_ref.updated["remarks"] == "Needs visual confirmation."
    assert document_ref.updated["remarksUpdatedAt"] == "SERVER_TIMESTAMP"


def test_patch_remarks_rejects_other_user_record(monkeypatch):
    snapshots = [
        FakeSnapshot(
            "doc-1",
            {
                "uid": "other-user",
                "prediction": "Defective",
                "defect": "Excess Solder",
            },
        )
    ]
    fake_client = FakeFirestoreClient(snapshots)
    monkeypatch.setattr(history_routes.firestore, "client", lambda: fake_client)

    app = create_test_app(fake_client)
    response = app.test_client().patch(
        "/inspections/doc-1/remarks",
        json={"remarks": "Trying to update."},
    )

    assert response.status_code == 403
    assert response.get_json()["error"] == "forbidden"


def test_patch_remarks_rejects_long_text(monkeypatch):
    fake_client = FakeFirestoreClient([])
    monkeypatch.setattr(history_routes.firestore, "client", lambda: fake_client)

    app = create_test_app(fake_client)
    response = app.test_client().patch(
        "/inspections/doc-1/remarks",
        json={"remarks": "x" * 501},
    )

    assert response.status_code == 400
    assert response.get_json()["error"] == "remarks_too_long"
