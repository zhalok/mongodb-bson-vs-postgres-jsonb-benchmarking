FROM golang:1.25-alpine AS build

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./
RUN go build -o postgres-exporter .

FROM alpine:3.20

COPY --from=build /app/postgres-exporter /usr/local/bin/postgres-exporter

EXPOSE 9101

CMD ["postgres-exporter"]
