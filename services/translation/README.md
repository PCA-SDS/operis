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
