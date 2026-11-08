# Learning Hub release image: the backend API and the built frontend on one port (8080).

FROM node:24-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LH_STATIC_DIR=/app/static \
    LH_STORAGE_DIR=/data \
    LH_PUBLIC_URL=http://localhost:8080
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# Same layout as the repository, so roadmaps/ and news/ are found next to backend/.
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY roadmaps /app/roadmaps
COPY news /app/news
COPY --from=frontend /src/frontend/dist /app/static
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    && useradd --create-home --uid 10001 hub \
    && mkdir -p /data && chown hub /data
USER hub
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
