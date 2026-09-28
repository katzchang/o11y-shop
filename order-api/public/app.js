// Keep in sync with PRICES in server.js.
const MENU = {
  coffee: { name: 'コーヒー', price: 450 },
  latte: { name: 'ラテ', price: 550 },
  sandwich: { name: 'サンドイッチ', price: 780 },
  cake: { name: 'ケーキ', price: 520 },
};
const CUSTOMER_ID = 'c-web';
const SLOW_MS = 900;
const STATUS_LABEL = { pending: '……', paid: '支払済', payment_failed: '決済失敗' };

const cart = Object.fromEntries(Object.keys(MENU).map((sku) => [sku, 0]));
const mine = new Set();

const $ = (sel) => document.querySelector(sel);
const orderBtn = $('#order-btn');
const result = $('#result');

const yen = (n) => `¥${n.toLocaleString('ja-JP')}`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const shortId = (id) => (id ? id.slice(0, 8) : '');

// ---- cart ----

document.querySelectorAll('.dish').forEach((dish) => {
  const sku = dish.dataset.sku;
  dish.addEventListener('click', (e) => {
    const btn = e.target.closest('.qty-btn');
    if (!btn) return;
    cart[sku] = Math.max(0, Math.min(9, cart[sku] + Number(btn.dataset.delta)));
    renderCart();
  });
});

function cartItems() {
  return Object.entries(cart)
    .filter(([, qty]) => qty > 0)
    .map(([sku, qty]) => ({ sku, qty }));
}

function renderCart() {
  let total = 0;
  document.querySelectorAll('.dish').forEach((dish) => {
    const qty = cart[dish.dataset.sku];
    dish.querySelector('.qty-count').textContent = qty;
    dish.classList.toggle('is-picked', qty > 0);
    total += MENU[dish.dataset.sku].price * qty;
  });
  $('#total').textContent = yen(total);
  orderBtn.disabled = total === 0 || orderBtn.dataset.busy === 'true';
}

function resetCart() {
  Object.keys(cart).forEach((sku) => { cart[sku] = 0; });
  renderCart();
}

// ---- result panel ----

let ticker = 0;

function showResult(state, html) {
  cancelAnimationFrame(ticker);
  result.dataset.state = state;
  // restart CSS animations (e.g. shake on consecutive failures)
  result.style.animation = 'none';
  void result.offsetWidth;
  result.style.animation = '';
  result.innerHTML = html;
}

function showIdle() {
  showResult('idle', '<p class="result-hint">お品を……選んで……<br>注文して……ごらん……</p>');
}

function showPending(started) {
  showResult('pending', `
    <p class="result-big">ゴゴゴゴ…</p>
    <p class="result-sub">決済の……返事を……待っている……</p>
    <p class="elapsed" id="elapsed">0ms</p>`);
  const el = $('#elapsed');
  const tick = () => {
    const ms = Math.round(performance.now() - started);
    el.textContent = `${ms}ms`;
    el.classList.toggle('is-late', ms >= SLOW_MS);
    ticker = requestAnimationFrame(tick);
  };
  ticker = requestAnimationFrame(tick);
}

function showPaid(order, ms) {
  showResult('paid', `
    <p class="result-big">毎度ありィ!!</p>
    <p class="result-sub">${yen(order.amount)} ……たしかに……<br>いただきました……</p>
    <span class="stamp">済</span>
    <p class="result-meta">${ms}ms ・ 注文 ${escapeHtml(shortId(order.id))}</p>`);
}

function showFailed(body, ms) {
  showResult('failed', `
    <p class="result-big">ギャアアアッ!!</p>
    <p class="result-sub">決済が……消えた……!?</p>
    <p class="result-meta">${ms}ms ・ 注文 ${escapeHtml(shortId(body.orderId))}<br>${escapeHtml(body.error || 'payment failed')}</p>`);
}

function showError(message) {
  showResult('failed', `
    <p class="result-big">ヒィッ…</p>
    <p class="result-sub">${escapeHtml(message)}</p>`);
}

// ---- ordering ----

function setBusy(busy) {
  orderBtn.dataset.busy = String(busy);
  orderBtn.textContent = busy ? '……' : '注文する';
  renderCart();
}

async function placeOrder() {
  const items = cartItems();
  if (items.length === 0) return;

  setBusy(true);
  const started = performance.now();
  showPending(started);
  try {
    const res = await fetch('/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: CUSTOMER_ID, items }),
    });
    const body = await res.json().catch(() => ({}));
    const ms = Math.round(performance.now() - started);
    if (res.status === 201) {
      mine.add(body.id);
      showPaid(body, ms);
      resetCart();
    } else if (body.orderId) {
      mine.add(body.orderId);
      showFailed(body, ms);
    } else {
      showError(body.error || `HTTP ${res.status}`);
    }
  } catch {
    showError('お店と……連絡が……とれない……');
  } finally {
    setBusy(false);
    refreshOrders();
  }
}

orderBtn.addEventListener('click', placeOrder);

// ---- ledger ----

function describeItems(items) {
  return items.map((i) => `${MENU[i.sku]?.name ?? i.sku}×${i.qty || 1}`).join('、');
}

function renderOrders(orders) {
  const tbody = $('#orders');
  if (orders.length === 0) {
    tbody.innerHTML = '<tr><td class="empty" colspan="6">まだ……誰も……来ていない……</td></tr>';
  } else {
    tbody.innerHTML = orders.map((o) => {
      const ms = o.settledAt ? new Date(o.settledAt) - new Date(o.createdAt) : null;
      const classes = [
        o.status === 'payment_failed' ? 'is-failed' : '',
        mine.has(o.id) ? 'is-mine' : '',
      ].join(' ');
      return `<tr class="${classes}">
        <td>${new Date(o.createdAt).toLocaleTimeString('ja-JP')}</td>
        <td>${escapeHtml(o.customerId)}</td>
        <td class="items">${escapeHtml(describeItems(o.items))}</td>
        <td class="num">${yen(o.amount)}</td>
        <td class="num${ms >= SLOW_MS ? ' slow' : ''}">${ms === null ? '…' : `${ms}ms`}</td>
        <td><span class="badge badge-${escapeHtml(o.status)}">${STATUS_LABEL[o.status] ?? escapeHtml(o.status)}</span></td>
      </tr>`;
    }).join('');
  }

  const omen = $('#omen');
  const failed = orders.filter((o) => o.status === 'payment_failed').length;
  omen.classList.toggle('is-ominous', failed > 0);
  omen.textContent = failed === 0
    ? '今のところ……平穏……'
    : `直近${orders.length}件中 ${failed}件が失敗……何かが……おかしい……`;
}

async function refreshOrders() {
  try {
    const res = await fetch('/orders?limit=12');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderOrders(await res.json());
  } catch {
    $('#omen').textContent = 'お店が……閉まっている……?';
  }
}

renderCart();
showIdle();
refreshOrders();
setInterval(refreshOrders, 1000);
