# Faucet server image: zcash-devtool (wallet) + node (API). Built by .github/workflows/server-image.yml.
FROM rust:1-bookworm AS devtool
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler && rm -rf /var/lib/apt/lists/*
ARG DEVTOOL_REV=0b3436bb8d235c67cd36b800cb45a7b1b489c415
RUN git clone https://github.com/zcash/zcash-devtool /src && git -C /src checkout $DEVTOOL_REV
WORKDIR /src
RUN cargo build --release --features regtest_support --bin zcash-devtool

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=devtool /src/target/release/zcash-devtool /usr/local/bin/zcash-devtool
COPY server.js /app/server.js
ENV DATA_DIR=/data NODE_ENV=production
VOLUME /data
EXPOSE 8080
CMD ["node", "/app/server.js"]
