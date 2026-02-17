"""Tests for the PII Guard Presidio engine."""

import pytest
from fastapi.testclient import TestClient

from app import app

client = TestClient(app)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "PERSON" in data["entities_supported"]
    assert "EMAIL_ADDRESS" in data["entities_supported"]


def test_analyze_person():
    resp = client.post("/analyze", json={"text": "My name is John Smith"})
    assert resp.status_code == 200
    data = resp.json()
    types = [e["entity_type"] for e in data["entities"]]
    assert "PERSON" in types


def test_analyze_email():
    resp = client.post("/analyze", json={"text": "Email me at john@example.com"})
    assert resp.status_code == 200
    data = resp.json()
    types = [e["entity_type"] for e in data["entities"]]
    assert "EMAIL_ADDRESS" in types


def test_analyze_phone():
    resp = client.post("/analyze", json={"text": "Call me at +91 9876543210"})
    assert resp.status_code == 200
    data = resp.json()
    types = [e["entity_type"] for e in data["entities"]]
    assert "PHONE_NUMBER" in types


def test_analyze_credit_card():
    resp = client.post("/analyze", json={"text": "My credit card is 4111 1111 1111 1111"})
    assert resp.status_code == 200
    data = resp.json()
    types = [e["entity_type"] for e in data["entities"]]
    assert "CREDIT_CARD" in types


def test_analyze_ip():
    resp = client.post("/analyze", json={"text": "Server IP is 192.168.1.1"})
    assert resp.status_code == 200
    data = resp.json()
    types = [e["entity_type"] for e in data["entities"]]
    assert "IP_ADDRESS" in types


def test_analyze_pan():
    resp = client.post("/analyze", json={"text": "My PAN card number is ABCPT1234F"})
    assert resp.status_code == 200
    data = resp.json()
    types = [e["entity_type"] for e in data["entities"]]
    assert "IN_PAN" in types


def test_analyze_no_pii():
    resp = client.post("/analyze", json={"text": "The weather is nice today"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] == 0
    assert data["entities"] == []


def test_anonymize_person():
    resp = client.post("/anonymize", json={"text": "My name is John Smith"})
    assert resp.status_code == 200
    data = resp.json()
    assert "<PERSON>" in data["text"]
    assert "John Smith" not in data["text"]
    assert data["count"] >= 1


def test_anonymize_email():
    resp = client.post(
        "/anonymize", json={"text": "Contact me at john@example.com please"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "<EMAIL_ADDRESS>" in data["text"]
    assert "john@example.com" not in data["text"]


def test_anonymize_multiple():
    text = "My name is John Smith and my email is john@example.com. Call me at +1 555-123-4567."
    resp = client.post("/anonymize", json={"text": text})
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 2
    assert "John Smith" not in data["text"]
    assert "john@example.com" not in data["text"]


def test_anonymize_no_pii():
    resp = client.post(
        "/anonymize", json={"text": "The weather is nice today"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["text"] == "The weather is nice today"
    assert data["count"] == 0


def test_anonymize_returns_manifest():
    resp = client.post(
        "/anonymize", json={"text": "John Smith's email is john@example.com"}
    )
    assert resp.status_code == 200
    data = resp.json()
    for entity in data["entities"]:
        assert "entity_type" in entity
        assert "start" in entity
        assert "end" in entity
        assert "score" in entity
