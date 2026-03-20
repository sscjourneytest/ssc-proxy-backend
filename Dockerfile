# This version MUST match your error log exactly
FROM mcr.microsoft.com/playwright/python:v1.58.0-jammy

WORKDIR /app

# Installing exactly 1.58.0 to prevent version mismatch
COPY requirements.txt .
RUN pip install --no-cache-dir playwright==1.58.0 flask flask-cors gunicorn

COPY . .

EXPOSE 8080

# The CMD must be the ONLY way the app starts
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "app:app"]
