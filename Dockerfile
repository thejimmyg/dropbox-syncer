FROM node:alpine as base

FROM base as builder
RUN mkdir /app
WORKDIR /app
COPY bin/ /app/bin
COPY package.json /app
COPY package-lock.json /app
RUN npm install

FROM base

COPY --from=builder /app /app
WORKDIR /app
EXPOSE 9001
ENV NODE_PATH=/app/node_modules
ENV NODE_ENV=production
ENV PATH="${PATH}:/app/node_modules/.bin"
CMD ["node", "bin/server.js"]
