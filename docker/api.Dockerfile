FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /repo

COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --filter @limon/api...

WORKDIR /repo/apps/api
EXPOSE 3000
CMD ["sh", "-c", "pnpm exec tsx src/db/migrate.ts && pnpm exec tsx src/db/seed.ts && pnpm exec tsx src/db/import-catalog.ts && pnpm exec tsx src/db/import-recipes.ts && pnpm exec tsx src/db/import-parttypes.ts && pnpm exec tsx src/index.ts"]
