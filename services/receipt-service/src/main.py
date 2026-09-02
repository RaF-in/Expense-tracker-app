import logging

from fastapi import FastAPI

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("receipt-service")

app = FastAPI()
logger.info("receipt-service starting up, listening on port 8000")


@app.get("/")
def read_root():
    return {"service": "receipt-service", "status": "running"}
