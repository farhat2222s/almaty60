FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate && pnpm install --prod --frozen-lockfile
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node sql ./sql
USER node
EXPOSE 3080
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3080/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","src/server.mjs"]
