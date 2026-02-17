"""PII Guard Presidio Engine — FastAPI wrapper around presidio-analyzer + presidio-anonymizer."""

import os
from typing import Optional

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel, Field
from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

app = FastAPI(title="PII Guard Presidio Engine")

# --- Initialize engines programmatically ---


def create_analyzer() -> AnalyzerEngine:
    """Create analyzer with spaCy NER + Indian PII recognizers enabled."""

    # NLP engine with spaCy
    nlp_provider = NlpEngineProvider(nlp_configuration={
        "nlp_engine_name": "spacy",
        "models": [{"lang_code": "en", "model_name": "en_core_web_lg"}],
    })
    nlp_engine = nlp_provider.create_engine()

    # Create analyzer with default recognizers
    engine = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])

    # Enable built-in Indian recognizers (disabled by default)
    from presidio_analyzer.predefined_recognizers import (
        InAadhaarRecognizer,
        InPanRecognizer,
    )
    engine.registry.add_recognizer(InAadhaarRecognizer())
    engine.registry.add_recognizer(InPanRecognizer())

    # Custom UPI ID recognizer
    upi_recognizer = PatternRecognizer(
        supported_entity="IN_UPI_ID",
        name="UpiIdRecognizer",
        supported_language="en",
        patterns=[
            Pattern(
                name="upi_id",
                regex=r"\b[a-zA-Z0-9._-]+@(?:ybl|okhdfcbank|okicici|okaxis|oksbi|apl|ibl|sbi|axisb|icici|hdfc|paytm|upi|gpay|phonepe|freecharge|airtel|jio|kotak|barodampay|dbs|federal|indus|rbl|yesbank|citi|hsbc|sc|idbi|pnb|bob|canara|unionbank)\b",
                score=0.85,
            ),
        ],
        context=["upi", "payment", "pay", "gpay", "phonepe", "paytm", "vpa"],
    )
    engine.registry.add_recognizer(upi_recognizer)

    return engine


analyzer = create_analyzer()
anonymizer = AnonymizerEngine()

# Build operator map: each entity type -> replace with <TYPE> token
OPERATORS: dict[str, OperatorConfig] = {}
for entity_type in analyzer.get_supported_entities("en"):
    OPERATORS[entity_type] = OperatorConfig("replace", {"new_value": f"<{entity_type}>"})
OPERATORS["DEFAULT"] = OperatorConfig("replace", {"new_value": "<PII>"})


# --- Request / Response models ---


class AnalyzeRequest(BaseModel):
    text: str
    language: str = "en"
    score_threshold: float = Field(default=0.3, ge=0.0, le=1.0)


class EntityResult(BaseModel):
    entity_type: str
    start: int
    end: int
    score: float
    original_text: Optional[str] = None
    new_value: Optional[str] = None


class AnalyzeResponse(BaseModel):
    entities: list[EntityResult]
    count: int


class AnonymizeResponse(BaseModel):
    text: str
    entities: list[EntityResult]
    count: int


# --- Endpoints ---


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: AnalyzeRequest):
    results = analyzer.analyze(
        text=request.text,
        language=request.language,
        score_threshold=request.score_threshold,
    )
    entities = [
        EntityResult(
            entity_type=r.entity_type,
            start=r.start,
            end=r.end,
            score=round(r.score, 4),
            original_text=request.text[r.start : r.end],
        )
        for r in results
    ]
    return AnalyzeResponse(entities=entities, count=len(entities))


@app.post("/anonymize", response_model=AnonymizeResponse)
async def anonymize(request: AnalyzeRequest):
    # Step 1: detect entities
    analyzer_results = analyzer.analyze(
        text=request.text,
        language=request.language,
        score_threshold=request.score_threshold,
    )

    if not analyzer_results:
        return AnonymizeResponse(text=request.text, entities=[], count=0)

    # Step 2: anonymize
    anonymized = anonymizer.anonymize(
        text=request.text,
        analyzer_results=analyzer_results,
        operators=OPERATORS,
    )

    # Step 3: build manifest
    entities = []
    for item in anonymized.items:
        score = 0.0
        for r in analyzer_results:
            if r.entity_type == item.entity_type:
                score = r.score
                break

        entities.append(
            EntityResult(
                entity_type=item.entity_type,
                start=item.start,
                end=item.end,
                score=round(score, 4),
                original_text=item.text if item.operator == "replace" else None,
                new_value=item.text,
            )
        )

    return AnonymizeResponse(
        text=anonymized.text,
        entities=entities,
        count=len(entities),
    )


@app.get("/health")
async def health():
    supported = sorted(analyzer.get_supported_entities("en"))
    return {"status": "ok", "entities_supported": supported}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "9401"))
    uvicorn.run(app, host="127.0.0.1", port=port)
