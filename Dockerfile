# Use a pre-built Microsoft image that already has all browser libraries
FROM mcr.microsoft.com/playwright/python:v1.40.0-jammy

# Set the working directory
WORKDIR /app

# Copy only requirements first to use caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your application code
COPY . .

# Expose port 8080 (Railway's default)
EXPOSE 8080

# Start the application using gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "app:app"]
