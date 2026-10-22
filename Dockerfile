# ScopeGate — merchant gateway (Master Spec §9: node:22-alpine, minimal deps, native fetch/crypto)
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.js"]
