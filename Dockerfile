FROM node:26-alpine AS verify
WORKDIR /src
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm test && npm audit --audit-level=high

FROM node:26-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=verify --chown=node:node /src /app
RUN mkdir -p /app/data /app/backups /app/reports && chown -R node:node /app
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "app.js"]
