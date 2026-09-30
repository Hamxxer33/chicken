FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 DATA_DIR=/data
COPY package.json ./
COPY src ./src
COPY public ./public
CMD ["node", "src/server.js"]
