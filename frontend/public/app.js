const ordersBody = document.getElementById('ordersBody');
const orderCount = document.getElementById('orderCount');
const orderForm = document.getElementById('orderForm');
const formMsg = document.getElementById('formMsg');
const refreshBtn = document.getElementById('refreshBtn');

function fmtMoney(n) {
  return '$' + Number(n).toFixed(2);
}

function fmtDate(d) {
  return new Date(d).toLocaleString();
}

function renderOrders(orders) {
  orderCount.textContent = orders.length;
  if (orders.length === 0) {
    ordersBody.innerHTML = '<tr class="empty-row"><td colspan="7">No orders yet — place one above.</td></tr>';
    return;
  }
  ordersBody.innerHTML = orders.map(o => `
    <tr>
      <td>#${o.id}</td>
      <td>${escapeHtml(o.customer_name)}</td>
      <td>${escapeHtml(o.product_name)}</td>
      <td>${o.quantity}</td>
      <td>${fmtMoney(o.amount)}</td>
      <td><span class="status-pill status-${o.status}">${o.status.replace('_', ' ')}</span></td>
      <td>${fmtDate(o.created_at)}</td>
    </tr>
  `).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    if (!res.ok) throw new Error('request failed');
    const orders = await res.json();
    renderOrders(orders);
  } catch (err) {
    console.error('failed to load orders', err);
  }
}

orderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = orderForm.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  formMsg.textContent = 'Placing order and charging payment...';
  formMsg.className = 'form-msg';

  const payload = {
    customerName: document.getElementById('customerName').value,
    productName: document.getElementById('productName').value,
    quantity: Number(document.getElementById('quantity').value),
    amount: Number(document.getElementById('amount').value)
  };

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'order failed');

    formMsg.textContent = `Order #${data.id} created — payment ${data.paymentStatus || 'processing'}.`;
    formMsg.className = 'form-msg ok';
    orderForm.reset();
    document.getElementById('quantity').value = 1;
    document.getElementById('amount').value = '49.00';
    await loadOrders();
  } catch (err) {
    formMsg.textContent = `Error: ${err.message}`;
    formMsg.className = 'form-msg err';
  } finally {
    submitBtn.disabled = false;
  }
});

refreshBtn.addEventListener('click', loadOrders);

// --- Poll service health for the status dots in the left rail ---
async function pollHealth() {
  const targets = [
    { svc: 'frontend', url: '/health' },
    { svc: 'order', url: '/api/orders' },      // proxied — 200 implies order-service reachable
    { svc: 'payment', url: '/api/payments' }   // proxied — 200 implies payment-service reachable
  ];
  for (const t of targets) {
    const el = document.querySelector(`.dot[data-svc="${t.svc}"]`);
    try {
      const res = await fetch(t.url, { method: 'GET' });
      el.classList.toggle('up', res.ok);
      el.classList.toggle('down', !res.ok);
    } catch {
      el.classList.remove('up');
      el.classList.add('down');
    }
  }
}

loadOrders();
pollHealth();
setInterval(loadOrders, 8000);
setInterval(pollHealth, 8000);
