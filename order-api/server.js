const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const { trace } = require('@opentelemetry/api');

const PORT = Number(process.env.PORT || 8080);
const PAYMENT_URL = process.env.PAYMENT_URL || 'http://127.0.0.1:8081';
const PAYMENT_TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS || 1000);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// request info for the tracing backend
app.use((req, res, next) => {
  res.on('finish', () => {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute('http.method', req.method);
      span.setAttribute('http.url', req.originalUrl);
      span.setAttribute('http.status_code', res.statusCode);
    }
  });
  next();
});

const orders = new Map();

const PRICES = {
  coffee: 450,
  latte: 550,
  sandwich: 780,
  cake: 520,
};

app.post('/orders', async (req, res) => {
  const { customerId, items } = req.body || {};
  if (!customerId || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'customerId and items are required' });
  }

  let amount = 0;
  for (const item of items) {
    const price = PRICES[item.sku];
    if (!price) {
      return res.status(400).json({ error: `unknown sku: ${item.sku}` });
    }
    amount += price * (item.qty || 1);
  }

  const order = {
    id: crypto.randomUUID(),
    customerId,
    items,
    amount,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  orders.set(order.id, order);

  try {
    const resp = await fetch(`${PAYMENT_URL}/charges`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: order.id, amount, currency: 'JPY' }),
      signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS),
    });
    if (!resp.ok) {
      throw new Error(`payment failed with status ${resp.status}`);
    }
    const charge = await resp.json();
    order.status = 'paid';
    order.chargeId = charge.id;
    order.settledAt = new Date().toISOString();
    console.log(`order ${order.id} paid (${amount} JPY)`);
    return res.status(201).json(order);
  } catch (err) {
    order.status = 'payment_failed';
    order.settledAt = new Date().toISOString();
    console.error(`order ${order.id} payment error: ${err.message}`);
    return res.status(502).json({ error: 'payment failed', orderId: order.id });
  }
});

// most recent orders first
app.get('/orders', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json([...orders.values()].slice(-limit).reverse());
});

app.get('/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json(order);
});

app.get('/healthz', (req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`order-api listening on :${PORT}`);
});
