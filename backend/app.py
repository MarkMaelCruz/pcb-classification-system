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

from history_routes import register_history_routes
from inference.huggingface_yolo import (
    HuggingFaceInferenceError,
    predict_with_huggingface,
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG"}
DEFAULT_MODEL_VERSION = "mock-0.1.0"


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)

    if value is None:
        return default

    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    value = os.getenv(name)

    if value is None:
        return default

    try:
        return int(value)
    except ValueError:
        return default


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


def create_mock_prediction(width: int, height: int, model_version: str) -> dict[str, Any]:
    return {
        "prediction": "Defective",
        "defect": "Solder Bridge",
        "confidence": 91.5,
        "recommendation": (
            "Temporary mock result. Replace this detector with "
            "the trained object-detection model later."
        ),
        "modelVersion": model_version,
        "mock": True,
        "image": {
            "width": width,
            "height": height,
        },
        "detectionCount": 1,
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


def create_app(test_config: dict[str, Any] | None = None) -> Flask:
    app = Flask(__name__)

    app.config.from_mapping(
        MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,
        REQUIRE_AUTH=env_bool("REQUIRE_AUTH", True),
        SAVE_RESULTS_TO_FIRESTORE=env_bool("SAVE_RESULTS_TO_FIRESTORE", False),
        FIREBASE_PROJECT_ID=(
            os.getenv("FIREBASE_PROJECT_ID") or os.getenv("GOOGLE_CLOUD_PROJECT")
        ),
        ALLOWED_ORIGINS=parse_origins(
            os.getenv("ALLOWED_ORIGINS", "http://localhost:5173")
        ),
        INFERENCE_PROVIDER=os.getenv("INFERENCE_PROVIDER", "mock").strip().lower(),
        HF_PREDICT_URL=os.getenv("HF_PREDICT_URL", "").strip(),
        HF_REQUEST_TIMEOUT_SECONDS=env_int("HF_REQUEST_TIMEOUT_SECONDS", 180),
        MODEL_VERSION=os.getenv("MODEL_VERSION", DEFAULT_MODEL_VERSION).strip(),
    )

    if test_config:
        app.config.update(test_config)

    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    logger = app.logger

    inference_provider = app.config["INFERENCE_PROVIDER"]

    if inference_provider not in {"mock", "huggingface"}:
        raise RuntimeError("INFERENCE_PROVIDER must be 'mock' or 'huggingface'.")

    if inference_provider == "huggingface" and not app.config["HF_PREDICT_URL"]:
        raise RuntimeError(
            "HF_PREDICT_URL must be configured when "
            "INFERENCE_PROVIDER is set to huggingface."
        )

    CORS(
        app,
        resources={
            r"/.*": {
                "origins": app.config["ALLOWED_ORIGINS"],
                "allow_headers": ["Authorization", "Content-Type"],
                "methods": ["GET", "POST", "PATCH", "OPTIONS"],
            }
        },
    )

    logger.info("Configured CORS origins: %s", app.config["ALLOWED_ORIGINS"])
    logger.info("Configured inference provider: %s", inference_provider)

    if app.config["REQUIRE_AUTH"] or app.config["SAVE_RESULTS_TO_FIRESTORE"]:
        project_id = app.config["FIREBASE_PROJECT_ID"]

        if not project_id:
            raise RuntimeError(
                "FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT must be set when "
                "Firebase authentication or Firestore saving is enabled."
            )

        ensure_firebase_admin(project_id)

    def authenticate_request():
        if not app.config["REQUIRE_AUTH"]:
            return {
                "uid": "local-test-user",
                "email": "local@example.com",
            }, None

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

    register_history_routes(app, authenticate_request)

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
        provider = app.config["INFERENCE_PROVIDER"]

        return jsonify(
            {
                "status": "healthy",
                "service": "pcb-classification-api",
                "modelLoaded": (
                    provider == "huggingface" and bool(app.config["HF_PREDICT_URL"])
                ),
                "modelVersion": app.config["MODEL_VERSION"],
                "inferenceProvider": provider,
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

        if detected_format == "JPEG":
            detected_content_type = "image/jpeg"
        else:
            detected_content_type = "image/png"

        if app.config["INFERENCE_PROVIDER"] == "huggingface":
            try:
                result = predict_with_huggingface(
                    image_bytes=image_bytes,
                    filename=upload.filename,
                    content_type=detected_content_type,
                    image_width=width,
                    image_height=height,
                    predict_url=app.config["HF_PREDICT_URL"],
                    timeout_seconds=app.config["HF_REQUEST_TIMEOUT_SECONDS"],
                    model_version=app.config["MODEL_VERSION"],
                )
            except HuggingFaceInferenceError as exc:
                logger.exception("Hugging Face inference failed: %s", exc)
                return (
                    jsonify(
                        {
                            "error": "inference_unavailable",
                            "message": str(exc),
                        }
                    ),
                    502,
                )
        else:
            result = create_mock_prediction(
                width=width,
                height=height,
                model_version=app.config["MODEL_VERSION"],
            )

        if app.config["SAVE_RESULTS_TO_FIRESTORE"]:
            try:
                document = {
                    **result,
                    "uid": decoded_token["uid"],
                    "email": decoded_token.get("email"),
                    "imageUrl": None,
                    "timestamp": firestore.SERVER_TIMESTAMP,
                    "remarks": "",
                    "remarksUpdatedAt": None,
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