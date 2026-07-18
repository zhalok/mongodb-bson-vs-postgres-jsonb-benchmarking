package main

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type sizeStats struct {
	TableBytes map[string]int64
	IndexBytes map[string]int64
}

var db *sql.DB

func connect() *sql.DB {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		envOr("PGHOST", "postgres"),
		envOr("PGPORT", "5432"),
		envOr("PGUSER", "postgres"),
		envOr("PGPASSWORD", "postgres"),
		envOr("PGDATABASE", "postgres"),
	)

	conn, err := sql.Open("pgx", dsn)
	if err != nil {
		panic(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := conn.PingContext(ctx); err != nil {
		panic(err)
	}

	return conn
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func collectSizeStats(ctx context.Context) (sizeStats, error) {
	s := sizeStats{
		TableBytes: make(map[string]int64),
		IndexBytes: make(map[string]int64),
	}

	tableRows, err := db.QueryContext(ctx, `
		SELECT relname, pg_relation_size(oid)
		FROM pg_class
		WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
	`)
	if err != nil {
		return s, err
	}
	defer tableRows.Close()
	for tableRows.Next() {
		var name string
		var bytes int64
		if err := tableRows.Scan(&name, &bytes); err != nil {
			return s, err
		}
		s.TableBytes[name] = bytes
	}
	if err := tableRows.Err(); err != nil {
		return s, err
	}

	indexRows, err := db.QueryContext(ctx, `
		SELECT relname, pg_relation_size(oid)
		FROM pg_class
		WHERE relkind = 'i' AND relnamespace = 'public'::regnamespace
	`)
	if err != nil {
		return s, err
	}
	defer indexRows.Close()
	for indexRows.Next() {
		var name string
		var bytes int64
		if err := indexRows.Scan(&name, &bytes); err != nil {
			return s, err
		}
		s.IndexBytes[name] = bytes
	}
	if err := indexRows.Err(); err != nil {
		return s, err
	}

	return s, nil
}

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()

	stats, err := collectSizeStats(ctx)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain; version=0.0.4")

	fmt.Fprintf(w, "# HELP pg_table_size_bytes Size of a table in bytes\n")
	fmt.Fprintf(w, "# TYPE pg_table_size_bytes gauge\n")
	for name, bytes := range stats.TableBytes {
		fmt.Fprintf(w, "pg_table_size_bytes{table=\"%s\"} %d\n", name, bytes)
	}

	fmt.Fprintf(w, "# HELP pg_index_size_bytes Size of an index in bytes\n")
	fmt.Fprintf(w, "# TYPE pg_index_size_bytes gauge\n")
	for name, bytes := range stats.IndexBytes {
		fmt.Fprintf(w, "pg_index_size_bytes{index=\"%s\"} %d\n", name, bytes)
	}
}

func main() {
	db = connect()
	defer db.Close()

	http.HandleFunc("/metrics", metricsHandler)
	fmt.Println("pg-table-size-exporter listening on :9102")
	if err := http.ListenAndServe(":9102", nil); err != nil {
		panic(err)
	}
}
