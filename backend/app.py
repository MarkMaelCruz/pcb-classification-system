import io
import logging
import os
from typing import Any

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import firestore
from flask import Flask, jsonify, request
from flask_cors import CORS
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import RequestEntityTooLarge

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG"}
MODEL_VERSION = "mock-0.1.0"


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_origins(raw: str) -> list[str]:
    return [item.strip().rstrip("/") for item in raw.split(",") if item.strip()]


def ensure_firebase_admin(project_id: str | None) -> None:
    try:
        firebase_admin.get_app()
        return
    except ValueError:
        pass

    options = {"projectId": project_id} if project_id else None
    firebase_admin.initialize_app(options=options)


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__)
    app.config.from_mapping(
        MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,
        REQUIRE_AUTH=env_bool("REQUIRE_AUTH", True),
        SAVE_RESULTS_TO_FIRESTORE=env_bool("SAVE_RESULTS_TO_FIRESTORE", False),
        FIREBASE_PROJECT_ID=os.getenv("FIREBASE_PROJECT_ID")
        or os.getenv("GOOGLE_CLOUD_PROJECT"),
        ALLOWED_ORIGINS=parse_origins(
            os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
        ),
    )

    if test_config:
        app.config.update(test_config)

    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    logger = app.logger

    CORS(
        app,
        resources={
            r"/health": {"origins": "*"},
            r"/predict": {"origins": app.config["ALLOWED_ORIGINS"]},
        },
        allow_headers=["Authorization", "Content-Type"],
        methods=["GET", "POST", "OPTIONS"],
    )

    if app.config["REQUIRE_AUTH"] or app.config["SAVE_RESULTS_TO_FIRESTORE"]:
        project_id = app.config["FIREBASE_PROJECT_ID"]
        if not project_id:
            raise RuntimeError(
                "FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT must be set "
                "when Firebase authentication or Firestore saving is enabled."
            )
        ensure_firebase_admin(project_id)

    def authenticate_request():
        if not app.config["REQUIRE_AUTH"]:
            return {"uid": "local-test-user", "email": "local@example.com"}, None

        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return None, (
                jsonify(
                    {
                        "error": "unauthorized",
                        "message": "A Firebase ID token is required.",
                    }
                ),
                401,
            )

        token = header.removeprefix("Bearer ").strip()
        if not token:
            return None, (
                jsonify(
                    {
                        "error": "unauthorized",
                        "message": "The bearer token is empty.",
                    }
                ),
                401,
            )

        try:
            return firebase_auth.verify_id_token(token), None
        except (
            firebase_auth.InvalidIdTokenError,
            firebase_auth.ExpiredIdTokenError,
            firebase_auth.RevokedIdTokenError,
            firebase_auth.CertificateFetchError,
        ) as exc:
            logger.warning("Firebase token verification failed: %s", exc)
            return None, (
                jsonify(
                    {
                        "error": "unauthorized",
                        "message": "The Firebase ID token is invalid or expired.",
                    }
                ),
                401,
            )
        except Exception as exc:
            logger.exception("Unexpected authentication failure: %s", exc)
            return None, (
                jsonify(
                    {
                        "error": "authentication_unavailable",
                        "message": "Authentication could not be verified.",
                    }
                ),
                503,
            )

    @app.errorhandler(RequestEntityTooLarge)
    def handle_large_upload(_error):
        return (
            jsonify(
                {
                    "error": "file_too_large",
                    "message": "The uploaded image must not exceed 10 MB.",
                }
            ),
            413,
        )

    @app.get("/")
    def root():
        return jsonify(
            {
                "service": "pcb-classification-api",
                "status": "running",
                "healthEndpoint": "/health",
            }
        )

    @app.get("/health")
    def health():
        return jsonify(
            {
                "status": "healthy",
                "service": "pcb-classification-api",
                "modelLoaded": False,
                "modelVersion": MODEL_VERSION,
            }
        )

    @app.post("/predict")
    def predict():
        decoded_token, auth_error = authenticate_request()
        if auth_error:
            return auth_error

        if "file" not in request.files:
            return (
                jsonify(
                    {
                        "error": "missing_file",
                        "message": "Send the image using multipart field name 'file'.",
                    }
                ),
                400,
            )

        upload = request.files["file"]
        if not upload.filename:
            return (
                jsonify(
                    {
                        "error": "missing_filename",
                        "message": "The uploaded file has no filename.",
                    }
                ),
                400,
            )

        image_bytes = upload.read(MAX_UPLOAD_BYTES + 1)
        if len(image_bytes) > MAX_UPLOAD_BYTES:
            return (
                jsonify(
                    {
                        "error": "file_too_large",
                        "message": "The uploaded image must not exceed 10 MB.",
                    }
                ),
                413,
            )

        try:
            with Image.open(io.BytesIO(image_bytes)) as image:
                detected_format = image.format
                image.verify()

            if detected_format not in ALLOWED_IMAGE_FORMATS:
                return (
                    jsonify(
                        {
                            "error": "unsupported_image",
                            "message": "Only valid JPEG and PNG images are accepted.",
                        }
                    ),
                    415,
                )

            with Image.open(io.BytesIO(image_bytes)) as image:
                width, height = image.size
        except (UnidentifiedImageError, OSError, ValueError):
            return (
                jsonify(
                    {
                        "error": "invalid_image",
                        "message": "The uploaded file is not a valid JPEG or PNG image.",
                    }
                ),
                415,
            )

        result = {
            "prediction": "Defective",
            "defect": "Solder Bridge",
            "confidence": 91.5,
            "recommendation": (
                "Temporary mock result. Replace this detector with the trained "
                "object-detection model later."
            ),
            "modelVersion": MODEL_VERSION,
            "mock": True,
            "image": {"width": width, "height": height},
            "defects": [
                {
                    "id": "mock-1",
                    "type": "Solder Bridge",
                    "confidence": 91.5,
                    "x": 20,
                    "y": 25,
                    "width": 35,
                    "height": 20,
                }
            ],
        }

        if app.config["SAVE_RESULTS_TO_FIRESTORE"]:
            try:
                document = {
                    **result,
                    "uid": decoded_token["uid"],
                    "email": decoded_token.get("email"),
                    "imageUrl": None,
                    "timestamp": firestore.SERVER_TIMESTAMP,
                }
                document_ref = firestore.client().collection("inspections").document()
                document_ref.set(document)
                result["inspectionId"] = document_ref.id
            except Exception as exc:
                logger.exception("Could not save the inspection: %s", exc)
                return (
                    jsonify(
                        {
                            "error": "storage_unavailable",
                            "message": "The prediction could not be saved.",
                        }
                    ),
                    503,
                )

        return jsonify(result)

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port)
