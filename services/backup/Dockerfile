FROM alpine:3.24

RUN apk add --no-cache tar gzip coreutils findutils

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

ENTRYPOINT ["/backup.sh"]
