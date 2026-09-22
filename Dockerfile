FROM node:24-alpine
WORKDIR /app
COPY astra-server.mjs astra-responses.json ./
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "astra-server.mjs"]
