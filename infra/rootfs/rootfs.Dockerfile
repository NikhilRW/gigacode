ARG BASE=python:3.12-slim
FROM ${BASE}
COPY strip-rootfs.sh /strip.sh
RUN sh /strip.sh && rm /strip.sh
