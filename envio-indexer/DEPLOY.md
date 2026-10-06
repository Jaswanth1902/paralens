# ⚡ Envio HyperIndex Deployment Guide for ParaLens

> **Metropolis Envio Bounty Mandate**: Development-plan indexers are automatically deprecated after 30 days. Deployments must be created on or after **September 27** to remain active during judging (October 14–31). Deploying now (October 7) ensures your deployment is active through November 6!

---

## 1. Prerequisites (2 Minutes)
1. Sign up for a free Envio account at [envio.dev](https://envio.dev) (GitHub login).
2. Install the Envio CLI globally or use `pnpx`:
   ```bash
   pnpm add -g envio@latest
   ```

---

## 2. Headless Deployment to Envio Cloud
From within `Workspaces/ParaLens/envio-indexer`:

```bash
# Step 1: Login to Envio Cloud (browser or API token)
pnpx envio-cloud login

# Step 2: Register & Deploy
pnpx envio-cloud indexer add \
  --name paralens-monad-indexer \
  --description "ParaLens: Monad Parallel EVM Contention Indexer" \
  --branch main \
  --skip-repo-check \
  --yes

# Step 3: Check Live Deployment Status
pnpx envio-cloud indexer get paralens-monad-indexer
```

Once deployed, your live GraphQL endpoint will be available at:
`https://envio.dev/app/{your-username}/paralens-monad-indexer`

---

## 3. What Judges Will See
1. **Real-time Event Streaming**: Live deposits and transfers indexed from Monad Testnet (Chain ID 10143).
2. **Storage Contention Analytics**: Pre-computed collision frequencies across storage slots.
3. **Sub-second GraphQL Queries**: Instant query response times for the ParaLens Atelier HUD.
