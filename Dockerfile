# Appka i plánovač běží v jednom obrazu; co se spustí, určí příkaz
# (výchozí je web, plánovač se pouští jako druhý kontejner s `npm run worker`).
FROM node:22-slim AS deps
WORKDIR /app
# better-sqlite3 si pro linux/amd64 stáhne hotovou binárku; když by chyběla,
# doinstaluj sem python3, make a g++ a nech ji přeložit.
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_PATH=/data/v-merku.db
# Když je nastavená D1_PROXY_URL, DATABASE_PATH se nepoužije (viz src/db/connect.ts).

# Volitelné OCR pro obrázkové letáky – viz OCR_COMMAND v README.
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     ocrmypdf tesseract-ocr-ces && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
COPY src ./src
COPY scripts ./scripts

# Historie cen musí přežít redeploy. Na Cloudflare je disk kontejneru
# pomíjivý a data proto leží v D1; na jiném hostingu se /data připojuje
# zvenčí (compose.yaml, render.yaml).
EXPOSE 3000

CMD ["npm", "run", "start"]
