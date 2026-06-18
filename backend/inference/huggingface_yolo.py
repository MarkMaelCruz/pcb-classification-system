from __future__ import annotations

from typing import Any

import requests


class HuggingFaceInferenceError(RuntimeError):
    """Raised when the Hugging Face prediction API cannot be used."""


LABEL_MAP = {
    # Confirmed temporary-model label
    "exc_solder": "Excess Solder",

    # Common aliases that may be returned by the model
    "excess_solder": "Excess Solder",
    "ins_solder": "Insufficient Solder",
    "insufficient_solder": "Insufficient Solder",
    "solder_bridge": "Solder Bridge",
    "bridge": "Solder Bridge",
    "solder_spike": "Solder Spike",
    "spike": "Solder Spike",
    "no_defect": "No Defect",
    "good": "No Defect",
}


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(value, maximum))


def _display_label(raw_label: Any) -> str:
    normalized = str(raw_label or "").strip().lower()

    if not normalized:
        return "Unknown Defect"

    if normalized in LABEL_MAP:
        return LABEL_MAP[normalized]

    # Unknown labels remain readable instead of causing the API to fail.
    return normalized.replace("-", " ").replace("_", " ").title()


def _confidence_to_percent(raw_confidence: Any) -> float:
    try:
        confidence = float(raw_confidence)
    except (TypeError, ValueError) as exc:
        raise HuggingFaceInferenceError(
            "A Hugging Face detection contained an invalid confidence value."
        ) from exc

    # YOLO commonly returns confidence between 0 and 1.
    if 0 <= confidence <= 1:
        confidence *= 100

    return round(_clamp(confidence, 0, 100), 2)


def _box_to_percentages(
    raw_box: Any,
    image_width: int,
    image_height: int,
) -> dict[str, float]:
    if not isinstance(raw_box, dict):
        raise HuggingFaceInferenceError(
            "A Hugging Face detection did not contain a valid box object."
        )

    try:
        x0 = float(raw_box["x0"])
        y0 = float(raw_box["y0"])
        x1 = float(raw_box["x1"])
        y1 = float(raw_box["y1"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HuggingFaceInferenceError(
            "A Hugging Face bounding box was incomplete or invalid."
        ) from exc

    if image_width <= 0 or image_height <= 0:
        raise HuggingFaceInferenceError(
            "The uploaded image dimensions are invalid."
        )

    x0 = _clamp(x0, 0, image_width)
    x1 = _clamp(x1, 0, image_width)
    y0 = _clamp(y0, 0, image_height)
    y1 = _clamp(y1, 0, image_height)

    left = min(x0, x1)
    right = max(x0, x1)
    top = min(y0, y1)
    bottom = max(y0, y1)

    return {
        "x": round((left / image_width) * 100, 4),
        "y": round((top / image_height) * 100, 4),
        "width": round(((right - left) / image_width) * 100, 4),
        "height": round(((bottom - top) / image_height) * 100, 4),
    }


def normalize_huggingface_result(
    payload: Any,
    image_width: int,
    image_height: int,
    model_version: str,
) -> dict[str, Any]:
    """
    Convert the Hugging Face YOLO response into the API structure
    already expected by the React frontend.
    """

    if not isinstance(payload, dict):
        raise HuggingFaceInferenceError(
            "Hugging Face returned an unexpected response."
        )

    raw_detections = payload.get("detections", [])

    if not isinstance(raw_detections, list):
        raise HuggingFaceInferenceError(
            "The Hugging Face detections field was not a list."
        )

    defects: list[dict[str, Any]] = []

    for index, detection in enumerate(raw_detections, start=1):
        if not isinstance(detection, dict):
            continue

        defect_type = _display_label(detection.get("label"))

        # A no-defect label should not be drawn as a defect box.
        if defect_type == "No Defect":
            continue

        box = _box_to_percentages(
            detection.get("box"),
            image_width,
            image_height,
        )

        # Ignore boxes with no visible area.
        if box["width"] <= 0 or box["height"] <= 0:
            continue

        defects.append(
            {
                "id": f"hf-{index}",
                "type": defect_type,
                "confidence": _confidence_to_percent(
                    detection.get("confidence")
                ),
                **box,
            }
        )

    defects.sort(
        key=lambda item: item["confidence"],
        reverse=True,
    )

    if defects:
        primary = defects[0]

        return {
            "prediction": "Defective",
            "defect": primary["type"],
            "confidence": primary["confidence"],
            "recommendation": (
                "Review the highlighted solder area and confirm the "
                "detected defect before making a repair decision."
            ),
            "modelVersion": model_version,
            "mock": False,
            "image": {
                "width": image_width,
                "height": image_height,
            },
            "detectionCount": len(defects),
            "defects": defects,
        }

    return {
        "prediction": "No Defect",
        "defect": "No Defect",
        "confidence": 0.0,
        "recommendation": (
            "The temporary YOLO model did not return any defect "
            "detections above its configured threshold."
        ),
        "modelVersion": model_version,
        "mock": False,
        "image": {
            "width": image_width,
            "height": image_height,
        },
        "detectionCount": 0,
        "defects": [],
    }


def predict_with_huggingface(
    *,
    image_bytes: bytes,
    filename: str,
    content_type: str,
    image_width: int,
    image_height: int,
    predict_url: str,
    timeout_seconds: int,
    model_version: str,
) -> dict[str, Any]:
    """Send one validated image to the Hugging Face prediction API."""

    if not predict_url:
        raise HuggingFaceInferenceError(
            "HF_PREDICT_URL is not configured."
        )

    try:
        response = requests.post(
            predict_url,
            headers={
                "accept": "application/json",
            },
            files={
                "file": (
                    filename,
                    image_bytes,
                    content_type,
                )
            },
            timeout=timeout_seconds,
        )

        response.raise_for_status()

    except requests.Timeout as exc:
        raise HuggingFaceInferenceError(
            "The Hugging Face model took too long to respond."
        ) from exc

    except requests.RequestException as exc:
        status_code = (
            exc.response.status_code
            if exc.response is not None
            else "unavailable"
        )

        raise HuggingFaceInferenceError(
            f"The Hugging Face API request failed. Status: {status_code}."
        ) from exc

    try:
        payload = response.json()
    except ValueError as exc:
        raise HuggingFaceInferenceError(
            "Hugging Face returned a response that was not valid JSON."
        ) from exc

    return normalize_huggingface_result(
        payload=payload,
        image_width=image_width,
        image_height=image_height,
        model_version=model_version,
    )