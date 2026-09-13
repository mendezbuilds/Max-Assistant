FROM node:22-slim AS base
WORKDIR /repo

# Install deps for the whole workspace (needed because npm workspaces
# hoists shared deps to the root node_modules).
COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/core/package.json apps/core/package.json
RUN npm install

COPY packages packages
COPY apps/core apps/core

RUN npm run build --workspace=@max/db
RUN npm run build --workspace=@max/shared
RUN npm run build --workspace=@max/core

WORKDIR /repo/apps/core
CMD ["node", "dist/index.js"]
