import io


def test_health_returns_200(client):
    response = client.get("/health")
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["status"] == "healthy"
    assert payload["modelLoaded"] is False


def test_predict_rejects_missing_file(client):
    response = client.post("/predict")
    assert response.status_code == 400
    assert response.get_json()["error"] == "missing_file"


def test_predict_rejects_invalid_image(client):
    response = client.post(
        "/predict",
        data={"file": (io.BytesIO(b"not-an-image"), "fake.png")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 415
    assert response.get_json()["error"] == "invalid_image"


def test_predict_accepts_valid_png(client, valid_png):
    response = client.post(
        "/predict",
        data={"file": (valid_png, "board.png")},
        content_type="multipart/form-data",
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload["prediction"] == "Defective"
    assert payload["defect"] == "Solder Bridge"
    assert payload["mock"] is True
    assert payload["image"] == {"width": 100, "height": 80}
    assert payload["defects"]


def test_bounding_boxes_use_percentage_ranges(client, valid_png):
    response = client.post(
        "/predict",
        data={"file": (valid_png, "board.png")},
        content_type="multipart/form-data",
    )
    defect = response.get_json()["defects"][0]

    for field in ("x", "y", "width", "height"):
        assert 0 <= defect[field] <= 100


def test_predict_rejects_file_larger_than_10_mb(client):
    oversized = io.BytesIO(b"x" * (10 * 1024 * 1024 + 1))
    response = client.post(
        "/predict",
        data={"file": (oversized, "large.png")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 413


def test_predict_preflight_allows_configured_origin(client):
    origin = "http://localhost:5173"

    response = client.options(
        "/predict",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code in {200, 204}
    assert response.headers.get("Access-Control-Allow-Origin") == origin

    allowed_headers = response.headers.get(
        "Access-Control-Allow-Headers",
        "",
    ).lower()

    assert "authorization" in allowed_headers
    assert "content-type" in allowed_headers