# Two Lenses: server + loop (Argon, headless Chrome recording, ffmpeg, yt-dlp).
# Runs as uid 1000 on port 7860 (Hugging Face Spaces conventions). Set GEMINI_API_KEY as a secret.
FROM node:22-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3-pip ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp \
  && rm -rf /var/lib/apt/lists/*
# Newer YouTube extraction needs a JS runtime; node is already here.
RUN printf -- '--js-runtimes node\n' > /etc/yt-dlp.conf

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
# Google Chrome (not Chromium) so the player can decode H.264 news clips.
RUN npm ci --omit=dev \
  && npx playwright install --with-deps chrome \
  && npx playwright install ffmpeg \
  && chmod -R a+rx /ms-playwright

COPY --chown=1000:1000 . .
RUN mkdir -p out && chown -R 1000:1000 /app

USER 1000
ENV HOST=0.0.0.0 PORT=7860 HOME=/home/node
EXPOSE 7860
CMD ["node", "src/server.js"]
