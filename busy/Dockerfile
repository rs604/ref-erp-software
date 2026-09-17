# The Busy parse service.
#
# THE BUILD CONTEXT IS busy/, NOT busy/parse-service/, AND THAT IS THE POINT.
# There is one parser file in this project: busy/busy_parser.py. The service
# does not keep a copy of it. It had one once, the two drifted, and the copy
# inside the service was months behind without anything saying so — which is
# exactly the version skew that migration 45 exists to catch. A build from
# here picks up the one real file every time.
#
# mdbtools is the reason this is a container and not a Supabase edge function:
# reading a Busy .bds file needs mdb-export, which is a Linux program, and an
# edge function cannot have one installed.
#
#   docker build -t busy-parse -f busy/Dockerfile busy/     (from the repo root)

FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends mdbtools \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY parse-service/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The one parser file, and the wrapper around it.
COPY busy_parser.py ./
COPY parse-service/app.py ./

ENV PORT=8080
EXPOSE 8080

# One worker, long timeout: a year file takes a while to parse and it is one
# person uploading, not a crowd.
CMD exec gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 900 app:app
