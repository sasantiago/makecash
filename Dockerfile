# Conway Automaton — imagen aislada para ejecución 24/7
# El agente ejecuta comandos de shell dentro de ESTE contenedor, no en el host.
FROM node:22-bookworm

# Herramientas útiles para el agente (git para self-mod/upstream, python, curl, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates python3 python3-pip jq tini \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/cli/package.json packages/cli/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build && sed -i 's/\r$//' scripts/*.sh && chmod +x scripts/*.sh \
    && printf '#!/bin/sh\nexec node /app/dist/pipeline/cli.js "$@"\n' > /usr/local/bin/makecash \
    && chmod +x /usr/local/bin/makecash

ENV NODE_ENV=production \
    HOME=/root

# Estado persistente (wallet, config, SOUL.md, state.db, skills)
VOLUME ["/root/.automaton"]

ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/docker-entrypoint.sh"]
CMD ["--run"]
