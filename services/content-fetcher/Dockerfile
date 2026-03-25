FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Startup: write YouTube cookies from env to file, then start server
CMD ["sh", "-c", "echo \"$YOUTUBE_COOKIES\" > /app/cookies.txt && gunicorn main:app -w 2 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000"]
