# Stage 1 — build. Keeps the Python toolchain off the host (ARCH A13).
FROM python:3.12-slim AS build
WORKDIR /src

COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

COPY src/ ./src/

# Stage 2 — runtime.
FROM python:3.12-slim AS runtime
WORKDIR /app

COPY --from=build /install /usr/local
COPY --from=build /src/src ./src

EXPOSE 8000
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
