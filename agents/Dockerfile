# NIXO agents (FastAPI). Build from agents/: docker build -t nixo-agents agents
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY pyproject.toml ./
COPY app ./app
RUN pip install . \
 && useradd --system --uid 10001 --home /app nixo \
 && mkdir -p /data/copy /data/viewing /data/live \
 && chown -R nixo /data

USER nixo
# Encrypted runtime stores (copy feeds, viewing keys, live sessions). Mount a volume here.
ENV NIXO_COPY_STORE=/data/copy \
    NIXO_VIEWING_STORE=/data/viewing \
    NIXO_LIVE_STORE=/data/live
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

# One worker: copy-trade feeds, live sessions and LLM cooldowns live in process memory.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
