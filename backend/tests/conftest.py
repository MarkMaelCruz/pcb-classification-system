import io
import os
import sys
from pathlib import Path

import pytest
from PIL import Image

# Disable production Firebase requirements while importing the Flask app in tests.
os.environ["REQUIRE_AUTH"] = "false"
os.environ["SAVE_RESULTS_TO_FIRESTORE"] = "false"

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app import create_app  # noqa: E402


@pytest.fixture()
def app():
    application = create_app(
        {
            "TESTING": True,
            "REQUIRE_AUTH": False,
            "SAVE_RESULTS_TO_FIRESTORE": False,
            "ALLOWED_ORIGINS": ["http://localhost:5173"],
        }
    )
    yield application


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def valid_png():
    buffer = io.BytesIO()
    Image.new("RGB", (100, 80), "white").save(buffer, format="PNG")
    buffer.seek(0)
    return buffer