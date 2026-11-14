#!/usr/bin/env python3
"""Split the repo-root .env.deploy into per-service env files.

    python3 -I deploy/aws/split_env.py --agents-domain agents.1-2-3-4.sslip.io \
        --backend-domain api.1-2-3-4.sslip.io --web-origin https://nixo.vercel.app

Writes (all git-ignored):
    deploy/aws/agents.env   agents container
    deploy/aws/backend.env  backend container
    deploy/aws/.env         compose variables (domains)
    deploy/aws/.state/vercel.env  web vars to paste or import into Vercel

AGENTS_API_URL, CORS_ORIGINS and FRONTEND_ORIGIN are derived from the flags, so
the placeholders in .env.deploy never reach a service.
"""
import argparse
import json
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

AGENTS = re.compile(
    r"^(AGENTS_API_TOKEN|CORS_ORIGINS|NIXO_CONTRACT|NIXO_VAULT_CONTRACT|NEAR_RPC|LLM_PROVIDER_ORDER"
    r"|(ANTHROPIC|OPENAI|DEEPSEEK|NVIDIA|NEARAI)_\w+|ONECLICK_JWT|NIXO_KEYS_CONTRACT|NIXO_COPY_\w+"
    r"|NIXO_VIEWING_KEY_DELAY|NIXO_LIVE_\w+|NIXO_AGENT_\w+)$"
)
WEB = re.compile(
    r"^(NEXT_PUBLIC_\w+|AGENTS_API_URL|AGENTS_API_TOKEN|DEMO_\w+|NIXO_REQUEST_DEPOSIT|NEARBLOCKS_API_KEY"
    r"|CHECK_LIVE_MAX_CALLS|NEARAI_\w+)$"
)
BACKEND = re.compile(r"^(FRONTEND_ORIGIN)$")


def parse(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        m = re.match(r"^\s*([A-Za-z_]\w*)=(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def write(path: Path, env: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.writelines(f"{k}={v}\n" for k, v in env.items() if v != "")
    print(f"wrote {path.relative_to(ROOT)} ({sum(1 for v in env.values() if v != '')} vars)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--agents-domain", required=True)
    ap.add_argument("--backend-domain", required=True)
    ap.add_argument("--web-origin", required=True, help="public web URL, e.g. https://nixo.vercel.app")
    ap.add_argument("--src", default=str(ROOT / ".env.deploy"))
    a = ap.parse_args()

    env = parse(Path(a.src))
    if not env.get("AGENTS_API_TOKEN"):
        raise SystemExit("AGENTS_API_TOKEN is empty in .env.deploy")
    web_origin = a.web_origin.rstrip("/")
    env["CORS_ORIGINS"] = json.dumps([web_origin])
    env["FRONTEND_ORIGIN"] = web_origin
    env["AGENTS_API_URL"] = f"https://{a.agents_domain}"

    write(HERE / "agents.env", {k: v for k, v in env.items() if AGENTS.match(k)})
    write(HERE / "backend.env", {k: v for k, v in env.items() if BACKEND.match(k)})
    write(HERE / ".env", {"AGENTS_DOMAIN": a.agents_domain, "BACKEND_DOMAIN": a.backend_domain})
    write(HERE / ".state" / "vercel.env", {k: v for k, v in env.items() if WEB.match(k)})


if __name__ == "__main__":
    main()
