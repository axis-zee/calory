FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js dist/ data/ ./
RUN mkdir -p /app/data
EXPOSE 4002
CMD ["node", "server.js"]
