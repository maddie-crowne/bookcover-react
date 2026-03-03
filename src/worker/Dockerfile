FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY worker.py .

#this is where we will store the files that vrinda's function can access
ENV DATA_DIR=/data

ENTRYPOINT ["python", "worker.py"]

CMD ["python", "worker.py", "-", "-"]