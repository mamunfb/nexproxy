FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY public ./public
COPY server.js ./server.js
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
