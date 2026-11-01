FROM alpine:3.24

RUN apk add --no-cache tar gzip coreutils findutils python3

COPY backup.sh /backup.sh
COPY snapshot.py /snapshot.py
RUN chmod +x /backup.sh

ENTRYPOINT ["/backup.sh"]
