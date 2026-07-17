package main

import (
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

var baseURL = envOr("CLIENT_BASE_URL", "http://localhost:3001")

const (
	numWorkers  = 100
	pollGap     = 2 * time.Second
	httpTimeout = 10 * time.Second
)

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var httpClient = &http.Client{Timeout: httpTimeout}

func getOrders() error {
	resp, err := httpClient.Get(baseURL + "/orders")
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if _, err := io.Copy(io.Discard, resp.Body); err != nil {
		return err
	}

	if resp.StatusCode >= 300 {
		return &httpStatusError{resp.StatusCode}
	}
	return nil
}

type httpStatusError struct{ code int }

func (e *httpStatusError) Error() string {
	return "GET /orders -> unexpected status " + http.StatusText(e.code)
}

func worker(workerID int) {
	for {
		if err := getOrders(); err != nil {
			log.Printf("[reader-%d] GET /orders failed: %v\n", workerID, err)
		} else {
			log.Printf("[reader-%d] GET /orders ok\n", workerID)
		}
		time.Sleep(pollGap)
	}
}

func main() {
	log.Println("waiting 5s for the backend to be ready...")
	time.Sleep(5 * time.Second)

	var wg sync.WaitGroup
	wg.Add(numWorkers)
	for w := 0; w < numWorkers; w++ {
		go func(id int) {
			defer wg.Done()
			worker(id)
		}(w)
	}
	wg.Wait()
}
