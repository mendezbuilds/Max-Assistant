FROM node:22-slim AS base
WORKDIR /repo

COPY package.json package-lock.json* ./
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
RUN npm install

COPY packages packages
COPY apps/dashboard apps/dashboard

RUN npm run build --workspace=@max/db
RUN npm run build --workspace=@max/shared
RUN npm run build --workspace=@max/dashboard

WORKDIR /repo/apps/dashboard
EXPOSE 3000
CMD ["npm", "run", "start"]
