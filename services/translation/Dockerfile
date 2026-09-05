# Self-hosted translation engine.
#
# Two stages so the ~2GB of model weights are downloaded and converted once at
# build time rather than on every container start, and so the runtime image
# carries no build toolchain.
FROM python:3.11-slim AS models

ARG MODEL_ID=facebook/m2m100_418M
ARG QUANTIZATION=int8

# transformers 4.57.x: 4.46 predates the `dtype` argument CTranslate2 4.8's
# conversion path relies on, and the converter fails with an unexpected-keyword
# TypeError. torch is unpinned and CPU-only - it is used once, here, to read the
# checkpoint, and never ships in the runtime stage.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
      "ctranslate2==4.8.2" "transformers==4.57.6" "torch" "sentencepiece==0.2.0" \
 && apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# M2M100 is a many-to-many model: it translates fr<->vi directly rather than
# pivoting through English, which is the pair that matters here and the one a
# pivot degrades twice.
RUN ct2-transformers-converter \
      --model ${MODEL_ID} \
      --output_dir /models/m2m100_418m \
      --quantization ${QUANTIZATION} \
      --copy_files tokenizer_config.json special_tokens_map.json sentencepiece.bpe.model vocab.json

# The tokenizer lives in its OWN directory, not beside the converted weights.
# CTranslate2 writes its own `config.json` into the output dir, which has no
# `model_type` key - so `AutoTokenizer.from_pretrained` on that directory fails
# to recognise the model. Saving the HF tokenizer separately keeps the two
# formats from colliding.
RUN python -c "from transformers import AutoTokenizer; \
    AutoTokenizer.from_pretrained('${MODEL_ID}').save_pretrained('/models/tokenizer')"

# fastText language identification: 176 languages, ~1MB, and far steadier than a
# heuristic on the short text chat produces.
RUN curl -fsSL -o /models/lid.176.ftz https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz

FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    TRANSLATION_MODEL_DIR=/models/m2m100_418m \
    TRANSLATION_TOKENIZER_DIR=/models/tokenizer \
    TRANSLATION_DETECTOR_PATH=/models/lid.176.ftz \
    TRANSLATION_MODEL_REVISION=m2m100_418m-int8

RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY --from=models /models /models

# Unprivileged: this process handles text from users and has no reason to be root.
RUN useradd --system --uid 10001 translate && chown -R translate /srv /models
USER translate

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
