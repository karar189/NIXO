# agents

Python FastAPI service for NearArc agents.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env

uvicorn app.main:app --reload --port 8000   # http://localhost:8000/docs
pytest
```
