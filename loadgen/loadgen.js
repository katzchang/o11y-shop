// Sends orders to order-api at a steady pace.
const TARGET = process.env.TARGET || 'http://127.0.0.1:8080';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 500);

const SKUS = ['coffee', 'latte', 'sandwich', 'cake'];

function randomItems() {
  const n = 1 + Math.floor(Math.random() * 3);
  return Array.from({ length: n }, () => ({
    sku: SKUS[Math.floor(Math.random() * SKUS.length)],
    qty: 1 + Math.floor(Math.random() * 2),
  }));
}

async function tick() {
  const started = Date.now();
  try {
    const res = await fetch(`${TARGET}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: `c-${Math.floor(Math.random() * 100)}`,
        items: randomItems(),
      }),
    });
    const body = await res.json();
    if (res.ok) {
      await fetch(`${TARGET}/orders/${body.id}`);
    }
    console.log(`${res.status} ${Date.now() - started}ms`);
  } catch (err) {
    console.log(`error ${err.message}`);
  }
}

console.log(`sending orders to ${TARGET} every ${INTERVAL_MS}ms`);
setInterval(tick, INTERVAL_MS);
