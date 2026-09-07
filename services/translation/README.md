# Translation service

CTranslate2 running M2M100 418M behind a small HTTP API, self-hosted so message
text never leaves the deployment.

## Why a separate service

CTranslate2 is a C++/Python runtime with no TypeScript binding, so it cannot run
in the application process. That boundary is desirable anyway: model weights,
quantisation and thread counts are operational concerns, and the service holds
no user data, has no database, and knows nothing about tenants or conversations.
Authorisation happens in the application, before a request reaches here.

## Why this model

M2M100 is many-to-many: it translates `fr -> vi` **directly** rather than
pivoting through English. The alternative -- a pair model per direction -- would
need `fr -> en -> vi` for that pair, compounding error twice on the one pairing
with the least training data.

`OPUS-MT` pair models are likely better for `en <-> fr` and `en <-> vi`
specifically and can be added behind the same adapter once blind review says so.
`NLLB-200` is deliberately excluded: its licence is CC-BY-NC, so it cannot ship
in a commercial product.

## Build and run

    docker compose -f docker-compose.yml up -d translation

First build downloads and converts ~2GB of weights and takes several minutes.
Subsequent starts are seconds.

## API

    GET  /health
    POST /translate   { text, target_locale, source_locale? }
                   -> { body, source_locale, model_revision, detected_confidence }

Source language is detected here rather than in the application: chat messages
are short, and one detector that also does the translating beats two that can
disagree.

## Limits

- 4000 characters per request, mirroring the chat message cap.
- Single worker by default. Raise `--workers` only after measuring; each worker
  loads its own copy of the weights.


## Endpoints

| Path | Purpose |
|---|---|
| `GET /health` | Liveness. The process is serving; says nothing about the model. |
| `GET /ready` | Readiness. Loads model, tokenizer and detector, and reports the live limits and supported languages. This is what the container healthcheck uses. |
| `POST /detect` | The source language and its confidence, without translating. |
| `POST /translate` | One run of text, one target language. |

Liveness and readiness are separate because a container loading ~2GB of weights
is alive and must not be restarted for taking 90 seconds — but it also cannot
answer yet. One probe serving both roles has to choose which lie to tell.

`/detect` exists because a caller translating several runs of one message needs
ONE verdict for all of them. Detecting per run asks fastText about three-word
fragments, which is where it is least reliable: measured here, a single run of
ordinary French scored 0.40 and was declined while the whole message was
unambiguous.

## Limits, and why they are not only character counts

`TRANSLATION_MAX_CHARS` (4000) mirrors the chat module's message length. It is
not sufficient on its own, because tokens do not track characters across
scripts. Measured against the shipped tokenizer:

| 3900–4000 characters of | tokens |
|---|---|
| French | 1002 |
| Vietnamese | 1022 |
| Thai | 1202 |
| Latin text with emoji | 1562 |

CTranslate2 truncates silently past `max_input_length` and returns a result that
looks complete, so a Thai or emoji-heavy message was being half-translated and
cached that way permanently. `TRANSLATION_MAX_INPUT_TOKENS` (1024) is therefore
enforced explicitly and returns **413** rather than truncating. Output is capped
by `TRANSLATION_MAX_OUTPUT_TOKENS` (512) and a decode that reaches the ceiling
returns **502** rather than a truncated body.

`TRANSLATION_INTER_THREADS` (1) and `TRANSLATION_INTRA_THREADS` (4) are set
explicitly. Left unset, CTranslate2 uses one worker and sizes intra-op threads
to the **host** core count, which oversubscribes CPU the container does not own.

## Measured resource use

On a 14-core host, image `operis-translation`, CPU int8, one uvicorn worker:

| Concurrency | Requests | Throughput | p50 | p95 |
|---|---|---|---|---|
| 1 | 24 | 4.3/s | 200 ms | 970 ms |
| 4 | 24 | 5.6/s | 925 ms | 1046 ms |
| 8 | 24 | 6.0/s | 1600 ms | 1767 ms |

Resident memory held steady at **755 MiB** throughout, against the `mem_limit:
3g` in the production compose file. Throughput is flat past concurrency 4
because `inter_threads=1` serialises inference by design — latency grows with
concurrency while throughput does not, which is why the application bounds
concurrent calls rather than letting them queue here.
