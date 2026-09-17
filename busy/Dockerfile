# The Busy parse service.
#
# mdbtools is the reason this is a container and not a Supabase edge function:
# reading a Busy .bds file needs mdb-export, which is a Linux program, and an
# edge function cannot have one installed.

FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends mdbtools \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY busy_parser.py app.py ./

ENV PORT=8080
EXPOSE 8080

# One worker, long timeout: a year file takes a while to parse and it is one
# person uploading, not a crowd.
CMD exec gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 900 app:app
