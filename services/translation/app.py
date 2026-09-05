"""
Self-hosted translation service.

CTranslate2 behind a small HTTP API. It exists as a separate process because
CTranslate2 is a C++/Python runtime with no TypeScript binding -- embedding it
was never an option, and a service boundary is the right one anyway: model
weights, quantisation and thread counts are operational concerns that have no
business in the application image.

Scope is deliberately narrow. It translates text and reports what it detected.
It holds no user data, has no database, and knows nothing about tenants or
conversations -- authorisation happens in the application, before anything
reaches here.
"""
from __future__ import annotations

import os
import threading
import unicodedata
from functools import lru_cache
from typing import Optional

import ctranslate2
import fasttext
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoTokenizer

MODEL_DIR = os.environ.get("TRANSLATION_MODEL_DIR", "/models/m2m100_418m")
# Separate from MODEL_DIR: CTranslate2 writes its own config.json into the
# converted-weights directory, and AutoTokenizer cannot read that as a model.
TOKENIZER_DIR = os.environ.get("TRANSLATION_TOKENIZER_DIR", "/models/tokenizer")
MODEL_REVISION = os.environ.get("TRANSLATION_MODEL_REVISION", "m2m100_418m-int8")
DETECTOR_PATH = os.environ.get("TRANSLATION_DETECTOR_PATH", "/models/lid.176.ftz")
DEVICE = os.environ.get("TRANSLATION_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("TRANSLATION_COMPUTE_TYPE", "int8")
MAX_CHARS = int(os.environ.get("TRANSLATION_MAX_CHARS", "4000"))

# Mirrors MAX_MESSAGE_LENGTH in the chat module. A request longer than a message
# can be is a caller bug, not a translation problem.

app = FastAPI(title="Operis translation", version="1.0")


@lru_cache(maxsize=1)
def _translator() -> ctranslate2.Translator:
    return ctranslate2.Translator(MODEL_DIR, device=DEVICE, compute_type=COMPUTE_TYPE)


@lru_cache(maxsize=1)
def _tokenizer():
    return AutoTokenizer.from_pretrained(TOKENIZER_DIR)


# `translate` is a sync path operation, so FastAPI runs it in the anyio
# threadpool and `--workers 1` does not serialise it. The tokenizer is a single
# shared object whose source language is set by mutation, so two requests
# interleaving between the assignment and the encode give one of them the
# other's source language -- and the result is a fluent, plausible, wrong
# translation with no error and no signal. The lock covers exactly that pair.
_tokenizer_lock = threading.Lock()


@lru_cache(maxsize=1)
def _supported_languages() -> frozenset:
    return frozenset(_tokenizer().lang_code_to_token)


def _encode(text: str, source: str) -> list:
    with _tokenizer_lock:
        tokenizer = _tokenizer()
        tokenizer.src_lang = source
        return tokenizer.convert_ids_to_tokens(tokenizer.encode(text))


@lru_cache(maxsize=1)
def _detector():
    # fastText's compressed language id model: 176 languages, ~1MB, and far more
    # reliable than a heuristic on the short text chat produces.
    return fasttext.load_model(DETECTOR_PATH)


class TranslateIn(BaseModel):
    # Bounded here as well as below, so an oversized payload is rejected before
    # it is buffered and normalised. NFC composes rather than expands, so the
    # raw cap is never looser than the one applied to the normalised text.
    text: str = Field(min_length=1, max_length=MAX_CHARS)
    target_locale: str = Field(min_length=2, max_length=10)
    source_locale: Optional[str] = Field(default=None, min_length=2, max_length=10)


class TranslateOut(BaseModel):
    body: str
    source_locale: str
    model_revision: str
    detected_confidence: float


def _normalize(value: str) -> str:
    """
    NFC on both edges.

    Vietnamese stacks diacritics, so the same visible character has two byte
    representations. The application normalises too; doing it here as well means
    neither side has to trust the other, and a model that emits NFD cannot poison
    a cache keyed on the string.
    """
    return unicodedata.normalize("NFC", value)


def _detect(text: str) -> tuple[str, float]:
    labels, scores = _detector().predict(text.replace("\n", " "), k=1)
    return labels[0].replace("__label__", ""), float(scores[0])


@app.get("/health")
def health() -> dict:
    # Touches the real objects so a broken model directory fails the check rather
    # than passing until first use.
    _translator()
    _tokenizer()
    _detector()
    _supported_languages()
    return {"ok": True, "model_revision": MODEL_REVISION, "device": DEVICE}


@app.post("/translate", response_model=TranslateOut)
def translate(body: TranslateIn) -> TranslateOut:
    text = _normalize(body.text)
    if len(text) > MAX_CHARS:
        raise HTTPException(status_code=413, detail=f"text exceeds {MAX_CHARS} characters")

    source, confidence = (body.source_locale, 1.0) if body.source_locale else _detect(text)

    if source == body.target_locale:
        # Nothing to do. Saying so is more useful than returning the input as if
        # work had happened.
        return TranslateOut(
            body=text, source_locale=source, model_revision=MODEL_REVISION,
            detected_confidence=confidence,
        )

    # fastText knows 176 languages and M2M100 models about 100, so an ordinary
    # short message can be detected as one the model has no token for. Left
    # unchecked that is a KeyError inside transformers and a 500 for input the
    # caller did nothing wrong with.
    supported = _supported_languages()
    if source not in supported:
        raise HTTPException(status_code=422, detail=f"unsupported source language '{source}'")
    if body.target_locale not in supported:
        raise HTTPException(
            status_code=422, detail=f"unsupported target language '{body.target_locale}'"
        )

    tokens = _encode(text, source)
    target_prefix = [_tokenizer().lang_code_to_token[body.target_locale]]

    results = _translator().translate_batch(
        [tokens], target_prefix=[target_prefix], beam_size=4, max_decoding_length=512,
    )
    hypothesis = results[0].hypotheses[0][1:]  # drop the forced language token
    tokenizer = _tokenizer()
    translated = tokenizer.decode(tokenizer.convert_tokens_to_ids(hypothesis))

    return TranslateOut(
        body=_normalize(translated), source_locale=source,
        model_revision=MODEL_REVISION, detected_confidence=confidence,
    )
