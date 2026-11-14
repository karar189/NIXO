# Deploying NIXO

| Part | Where | URL |
|---|---|---|
| Web (Next.js) | Vercel, region `bom1` (Mumbai) | set after the first deploy |
| Agents (FastAPI) | AWS EC2 `13.235.153.13`, Docker + Caddy | https://agents.13-235-153-13.sslip.io |
| Waitlist backend (NestJS) | same EC2 | https://api.13-235-153-13.sslip.io |
| Contracts | NEAR mainnet | `nixo.nixowallet.near`, `vault.nixowallet.near` |

All configuration starts from `.env.deploy` at the repo root (git-ignored).
`deploy/aws/split_env.py` turns it into one env file per service, including
`.env.vercel` for the web app.

## Web on Vercel

1. **New Project** → import `karar189/NIXO`.
2. **Root Directory:** `web`. Leave the framework (Next.js), install and build
   commands on their defaults. Keep **Include files outside the root directory
   in the Build Step** on (the default). `/api/check` and `/api/private-ai` read
   `fixtures/` and `checker/lists/` from the repo root.
3. **Environment Variables:** open the import box and paste the contents of
   `.env.vercel`. Apply them to Production and Preview.
4. **Deploy.**

`web/vercel.json` pins functions to `bom1`, next to the agents in
`ap-south-1`. `web/next.config.ts` bundles the repo-level data files those two
routes need.

`NEXT_PUBLIC_*` values are compiled into the browser bundle. After changing
one in Vercel, redeploy.

### After the first deploy

Point the agents' CORS origin and the backend's `FRONTEND_ORIGIN` at the
Vercel URL. Browsers only reach the agents through the Vercel proxy, so this is
hygiene, not a blocker.

```bash
python3 -I deploy/aws/split_env.py \
  --agents-domain agents.13-235-153-13.sslip.io \
  --backend-domain api.13-235-153-13.sslip.io \
  --web-origin https://<your-project>.vercel.app
scp -i ~/.ssh/nixo-backend.pem deploy/aws/agents.env deploy/aws/backend.env deploy/aws/.env \
  ubuntu@13.235.153.13:/opt/nixo/NIXO/deploy/aws/
ssh -i ~/.ssh/nixo-backend.pem ubuntu@13.235.153.13 \
  'cd /opt/nixo/NIXO/deploy/aws && docker compose up -d'
rm deploy/aws/agents.env deploy/aws/backend.env deploy/aws/.env
```

## Agents and backend on AWS

One EC2 instance (t4g.small, Ubuntu 24.04, AWS CLI profile `nixo`,
`ap-south-1`). Docker Compose runs `agents`, `backend` and `caddy`. Caddy gets
Let's Encrypt certificates for the sslip.io hostnames by itself. Agent state
(copy-trade feeds, viewing keys, live sessions) lives in the `agents-data`
volume and survives restarts. Resource IDs are in `deploy/aws/.state/aws.env`
(git-ignored).

**Redeploy after pushing to `master`:**

```bash
ssh -i ~/.ssh/nixo-backend.pem ubuntu@13.235.153.13 \
  'cd /opt/nixo/NIXO && git pull && cd deploy/aws && docker compose up -d --build'
```

**Logs:** `docker compose logs -f agents` (run it in `/opt/nixo/NIXO/deploy/aws`).

**Security:**
- Every agents route except `/health` requires the `X-Agents-Token` header.
  Only the Vercel proxy sends it, using `AGENTS_API_TOKEN`. The same value must
  be set on Vercel and on the server.
- SSH is open only to the deployer's IP. If your IP changes, add the new one to
  security group `nixo-backend`.
