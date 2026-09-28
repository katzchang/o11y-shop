package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"sync/atomic"
	"time"
)

type chargeRequest struct {
	OrderID  string `json:"orderId"`
	Amount   int    `json:"amount"`
	Currency string `json:"currency"`
}

type chargeResponse struct {
	ID      string `json:"id"`
	OrderID string `json:"orderId"`
	Status  string `json:"status"`
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func main() {
	port := envInt("PORT", 8081)
	gatewayPort := envInt("GATEWAY_PORT", 8082)
	gatewayTimeout := time.Duration(envInt("GATEWAY_TIMEOUT_MS", 3000)) * time.Millisecond

	var gatewayLatencyMs atomic.Int64
	gatewayLatencyMs.Store(int64(envInt("GATEWAY_LATENCY_MS", 200)))

	go runGateway(gatewayPort, &gatewayLatencyMs)

	client := &http.Client{Timeout: gatewayTimeout}
	gatewayURL := fmt.Sprintf("http://127.0.0.1:%d/v1/charge", gatewayPort)

	mux := http.NewServeMux()

	mux.HandleFunc("POST /charges", func(w http.ResponseWriter, r *http.Request) {
		var req chargeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if req.Amount <= 0 {
			http.Error(w, "invalid amount", http.StatusBadRequest)
			return
		}

		body, _ := json.Marshal(req)
		resp, err := client.Post(gatewayURL, "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("gateway error for order %s: %v", req.OrderID, err)
			http.Error(w, "gateway unavailable", http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			log.Printf("gateway declined order %s: %d", req.OrderID, resp.StatusCode)
			http.Error(w, "declined", http.StatusPaymentRequired)
			return
		}

		var out chargeResponse
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			http.Error(w, "bad gateway response", http.StatusBadGateway)
			return
		}
		log.Printf("charged order %s amount=%d", req.OrderID, req.Amount)
		w.Header().Set("content-type", "application/json")
		json.NewEncoder(w).Encode(out)
	})

	// change gateway latency at runtime: POST /admin/gateway-latency?ms=1500
	mux.HandleFunc("POST /admin/gateway-latency", func(w http.ResponseWriter, r *http.Request) {
		ms, err := strconv.Atoi(r.URL.Query().Get("ms"))
		if err != nil || ms < 0 {
			http.Error(w, "ms must be a non-negative integer", http.StatusBadRequest)
			return
		}
		gatewayLatencyMs.Store(int64(ms))
		log.Printf("gateway latency set to %dms", ms)
		fmt.Fprintf(w, "gateway latency: %dms\n", ms)
	})

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	})

	log.Printf("payment-svc listening on :%d (gateway timeout %s)", port, gatewayTimeout)
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", port), mux))
}

// runGateway is a stand-in for an external payment provider.
func runGateway(port int, latencyMs *atomic.Int64) {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/charge", func(w http.ResponseWriter, r *http.Request) {
		base := latencyMs.Load()
		jitter := rand.Int63n(base/5 + 1)
		time.Sleep(time.Duration(base+jitter) * time.Millisecond)

		var req chargeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if rand.Intn(50) == 0 {
			http.Error(w, "card declined", http.StatusPaymentRequired)
			return
		}
		w.Header().Set("content-type", "application/json")
		json.NewEncoder(w).Encode(chargeResponse{
			ID:      fmt.Sprintf("ch_%d", time.Now().UnixNano()),
			OrderID: req.OrderID,
			Status:  "succeeded",
		})
	})
	log.Printf("payment gateway (mock) listening on :%d", port)
	log.Fatal(http.ListenAndServe(fmt.Sprintf("127.0.0.1:%d", port), mux))
}
