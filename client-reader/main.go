package main

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
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

type ordersPage struct {
	NextCursor *string `json:"next_cursor"`
}

// getOrdersPage fetches one page (1000 rows, index-based keyset pagination on
// timestamp) and returns the cursor for the next page, or "" once exhausted.
func getOrdersPage(cursor string) (string, error) {
	reqURL := baseURL + "/orders"
	if cursor != "" {
		reqURL += "?cursor=" + url.QueryEscape(cursor)
	}

	resp, err := httpClient.Get(reqURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		io.Copy(io.Discard, resp.Body)
		return "", &httpStatusError{resp.StatusCode}
	}

	var page ordersPage
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		return "", err
	}

	if page.NextCursor == nil {
		return "", nil
	}
	return *page.NextCursor, nil
}

// scanAllOrders pages through the entire table via keyset pagination so each
// read call touches every row instead of repeatedly hitting the same cached page.
func scanAllOrders() (int, error) {
	cursor := ""
	pages := 0
	for {
		next, err := getOrdersPage(cursor)
		if err != nil {
			return pages, err
		}
		pages++
		if next == "" {
			return pages, nil
		}
		cursor = next
	}
}

type httpStatusError struct{ code int }

func (e *httpStatusError) Error() string {
	return "GET /orders -> unexpected status " + http.StatusText(e.code)
}

func worker(workerID int) {
	for {
		pages, err := scanAllOrders()
		if err != nil {
			log.Printf("[reader-%d] full scan failed after %d page(s): %v\n", workerID, pages, err)
		} else {
			log.Printf("[reader-%d] full scan ok, %d page(s)\n", workerID, pages)
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
