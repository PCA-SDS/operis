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
def _positive_int(name: str, default: int) -> int:
    """
    A limit that is wrong in the safe direction, loudly.

    `int(os.environ[...])` accepts "0" and "-1" happily, and a zero MAX_CHARS
    makes pydantic reject every request with a 422 while /health stays green --
    a total outage behind a healthy container.
    """
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise RuntimeError(f"{name} must be an integer, got {raw!r}") from None
    if value < 1:
        raise RuntimeError(f"{name} must be at least 1, got {value}")
    return value


MAX_CHARS = _positive_int("TRANSLATION_MAX_CHARS", 4000)
# CTranslate2 truncates silently at its own default (1024) with no signal in the
# result, so the tail of a long message would vanish and be cached that way
# forever. Declared here so the limit is ours and can be reported.
MAX_INPUT_TOKENS = _positive_int("TRANSLATION_MAX_INPUT_TOKENS", 1024)
MAX_OUTPUT_TOKENS = _positive_int("TRANSLATION_MAX_OUTPUT_TOKENS", 512)
# One translation at a time by default: the container is CPU-bound and sized for
# one, and letting the threadpool queue 40 deep only moves the wait somewhere
# nobody can see it.
INTER_THREADS = _positive_int("TRANSLATION_INTER_THREADS", 1)
INTRA_THREADS = _positive_int("TRANSLATION_INTRA_THREADS", 4)


def _unit_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        raise RuntimeError(f"{name} must be a number, got {raw!r}") from None
    if not 0.0 <= value <= 1.0:
        raise RuntimeError(f"{name} must be between 0 and 1, got {value}")
    return value


# Detection confidence, gated here rather than only in the caller so the engine
# does not spend a beam search to produce a result the caller will discard.
MIN_CONFIDENCE = _unit_float("TRANSLATION_MIN_CONFIDENCE", 0.5)

# Mirrors MAX_MESSAGE_LENGTH in the chat module. A request longer than a message
# can be is a caller bug, not a translation problem.

app = FastAPI(title="Operis translation", version="1.0")


# `lru_cache` caches only after the wrapped call RETURNS, so concurrent cold
# requests each build their own copy of the weights. Four probes during a 90s
# warmup is four times ~500MB against a 3g limit, which is an OOM kill of a
# container that was merely starting.
_load_lock = threading.Lock()


@lru_cache(maxsize=1)
def _translator() -> ctranslate2.Translator:
    with _load_lock:
        return ctranslate2.Translator(
            MODEL_DIR,
            device=DEVICE,
            compute_type=COMPUTE_TYPE,
            # Left to the library these default to one worker and to the HOST
            # core count -- on a shared box that oversubscribes CPU the
            # container does not own.
            inter_threads=INTER_THREADS,
            intra_threads=INTRA_THREADS,
        )


@lru_cache(maxsize=1)
def _tokenizer():
    with _load_lock:
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
    """
    Liveness. The process is up and serving; it says nothing about the model.

    Separate from readiness on purpose: a container still loading ~2GB of
    weights is alive and should not be restarted for taking 90 seconds, but it
    is also not able to answer yet. One probe serving both roles has to choose
    which lie to tell.
    """
    return {"ok": True, "model_revision": MODEL_REVISION, "device": DEVICE}


@app.get("/ready")
def ready() -> dict:
    # Touches the real objects, so a broken model directory, a missing tokenizer
    # or an unreadable detector fails the check rather than passing until the
    # first user request discovers it.
    _translator()
    _tokenizer()
    _detector()
    _supported_languages()
    return {
        "ok": True,
        "model_revision": MODEL_REVISION,
        "device": DEVICE,
        "limits": {
            "max_chars": MAX_CHARS,
            "max_input_tokens": MAX_INPUT_TOKENS,
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            "min_confidence": MIN_CONFIDENCE,
        },
        "threads": {"inter": INTER_THREADS, "intra": INTRA_THREADS},
        "languages": sorted(_supported_languages()),
    }


class DetectIn(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)


class DetectOut(BaseModel):
    source_locale: str
    confidence: float
    supported: bool


@app.post("/detect", response_model=DetectOut)
def detect(body: DetectIn) -> DetectOut:
    """
    What language this is, without translating it.

    Split out because a caller that has to translate several runs of one message
    needs ONE verdict for all of them: detecting per run asks fastText about
    three-word fragments, which is where it is least reliable, and lets one
    fragment disagree with the sentence it came from. Detecting on the whole
    message and asserting the answer per run is both cheaper and better.
    """
    text = _normalize(body.text)
    source, confidence = _detect(text)
    return DetectOut(
        source_locale=source,
        confidence=confidence,
        supported=source in _supported_languages(),
    )


@app.post("/translate", response_model=TranslateOut)
def translate(body: TranslateIn) -> TranslateOut:
    text = _normalize(body.text)
    if len(text) > MAX_CHARS:
        raise HTTPException(status_code=413, detail=f"text exceeds {MAX_CHARS} characters")

    source, confidence = (body.source_locale, 1.0) if body.source_locale else _detect(text)

    # Declined before the model runs, not after. A guess this weak is not worth
    # a beam search, and spending one first was paying for the answer the gate
    # exists to throw away.
    if confidence < MIN_CONFIDENCE:
        raise HTTPException(
            status_code=422,
            detail=f"source language could not be identified with confidence ({confidence:.2f})",
        )

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
    # Refuse rather than truncate. CTranslate2 drops the tail past
    # `max_input_length` and returns a normal-looking result, so a long message
    # would come back confidently half-translated and be cached that way.
    if len(tokens) > MAX_INPUT_TOKENS:
        raise HTTPException(
            status_code=413,
            detail=f"text is {len(tokens)} tokens; the limit is {MAX_INPUT_TOKENS}",
        )

    target_prefix = [_tokenizer().lang_code_to_token[body.target_locale]]

    results = _translator().translate_batch(
        [tokens],
        target_prefix=[target_prefix],
        beam_size=4,
        max_input_length=MAX_INPUT_TOKENS,
        max_decoding_length=MAX_OUTPUT_TOKENS,
    )
    if not results or not results[0].hypotheses:
        raise HTTPException(status_code=502, detail="engine returned no hypothesis")

    hypothesis = results[0].hypotheses[0]
    # The prefix is forced, so the first token is always the target-language
    # token. Asserting it rather than assuming keeps the slice honest if a
    # second prefix token is ever added.
    if hypothesis[:1] != target_prefix:
        raise HTTPException(status_code=502, detail="engine did not honour the target prefix")
    hypothesis = hypothesis[1:]

    # A decode that hit the ceiling is not a translation of the whole message.
    if len(hypothesis) >= MAX_OUTPUT_TOKENS - 1:
        raise HTTPException(
            status_code=502, detail="translation exceeded the output limit and would be truncated"
        )

    tokenizer = _tokenizer()
    # `skip_special_tokens` is not cosmetic: without it a stray `<unk>`, `</s>`
    # or `__xx__` in the hypothesis is rendered verbatim into a chat message,
    # and the renderer emits it as text because that is all it does.
    translated = tokenizer.decode(
        tokenizer.convert_tokens_to_ids(hypothesis), skip_special_tokens=True
    )
    if translated.strip() == "":
        raise HTTPException(status_code=502, detail="engine returned an empty translation")

    return TranslateOut(
        body=_normalize(translated), source_locale=source,
        model_revision=MODEL_REVISION, detected_confidence=confidence,
    )
