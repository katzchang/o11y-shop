# o11y-shop

A small coffee shop ordering system with two services.

- `order-api` (Node.js, Express): accepts orders and asks the payment service to charge them
- `payment-svc` (Go, net/http): charges orders through an external payment gateway (a mock runs inside the same process)
- `loadgen`: sends orders at a steady pace

```
loadgen ──> order-api :8080 ──> payment-svc :8081 ──> payment gateway (mock) :8082
```

## Requirements

- Node.js 22 or later
- Go 1.22 or later

## Run

```bash
cd order-api && npm install && cd ..
./scripts/start.sh
```

Ctrl-C stops everything.

## API

- `POST /orders` with `{"customerId": "c-1", "items": [{"sku": "latte", "qty": 1}]}`
- `GET /orders/:id`

SKUs: `coffee`, `latte`, `sandwich`, `cake`

## Configuration

| Service | Variable | Default |
|---|---|---|
| order-api | `PORT` | `8080` |
| order-api | `PAYMENT_URL` | `http://127.0.0.1:8081` |
| order-api | `PAYMENT_TIMEOUT_MS` | `1000` |
| payment-svc | `PORT` | `8081` |
| payment-svc | `GATEWAY_PORT` | `8082` |
| payment-svc | `GATEWAY_TIMEOUT_MS` | `3000` |
| payment-svc | `GATEWAY_LATENCY_MS` | `200` |
| loadgen | `TARGET` | `http://127.0.0.1:8080` |
| loadgen | `INTERVAL_MS` | `500` |

The gateway latency can be changed while running:

```bash
./scripts/slow-gateway.sh 1500   # slow
./scripts/slow-gateway.sh 200    # back to normal
```
