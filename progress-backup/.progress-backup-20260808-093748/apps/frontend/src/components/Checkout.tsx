import { useState } from 'react';
import { createOrder, captureOrder, getOrderStatus, type Order } from '../lib/payments.js';

export function Checkout() {
  const [provider, setProvider] = useState('razorpay');
  const [amount, setAmount] = useState('10.00');
  const [currency, setCurrency] = useState('USD');
  const [order, setOrder] = useState<Order | null>(null);
  const [status, setStatus] = useState('');
  const [err, setErr] = useState('');

  const create = async () => {
    setErr(''); setStatus(''); setOrder(null);
    try {
      const res = await createOrder({
        provider,
        amount: Number(amount),
        currency,
        description: 'Nexus demo checkout',
      });
      setOrder(res.order);
      setStatus(res.order.status);
      // Hosted-checkout providers return a paymentUrl to redirect to.
      if (res.order.paymentUrl) window.open(res.order.paymentUrl, '_blank');
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  const capture = async () => {
    if (!order) return;
    setErr('');
    try {
      const res = await captureOrder(provider, order.id);
      setOrder(res.order); setStatus(res.order.status);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  const checkStatus = async () => {
    if (!order) return;
    setErr('');
    try {
      const res = await getOrderStatus(provider, order.id);
      setOrder(res.order); setStatus(res.order.status);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  return (
    <div className="space-y-4 max-w-lg">
      <h2 className="text-xl font-bold">Checkout</h2>
      <p className="text-slate-500 text-sm">Creates an order through the backend <code>/payments/order</code> route, which calls the configured payment provider. Enabled providers depend on your <code>nexus.config.ts</code> + env keys.</p>
      <div className="bg-white border rounded-lg p-4 space-y-3">
        <label className="block text-sm">
          Provider
          <select className="w-full mt-1 px-3 py-2 border rounded" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="razorpay">Razorpay</option>
            <option value="paypal">PayPal</option>
            <option value="payu">PayU</option>
            <option value="skrill">Skrill</option>
            <option value="payoneer">Payoneer</option>
          </select>
        </label>
        <div className="flex gap-3">
          <label className="flex-1 text-sm">Amount
            <input className="w-full mt-1 px-3 py-2 border rounded" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="w-24 text-sm">Currency
            <input className="w-full mt-1 px-3 py-2 border rounded" value={currency} onChange={(e) => setCurrency(e.target.value)} />
          </label>
        </div>
        <button onClick={create} className="w-full px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500">Create order</button>
      </div>

      {err && <p className="text-red-600 text-sm">{err}</p>}
      {order && (
        <div className="bg-white border rounded-lg p-4 space-y-2 text-sm">
          <div><b>Order ID:</b> {order.id}</div>
          <div><b>Reference:</b> {order.reference}</div>
          <div><b>Status:</b> {status}</div>
          <div><b>Amount:</b> {order.amount} {order.currency}</div>
          {order.paymentUrl && <div><b>Payment URL:</b> <a className="text-indigo-600 break-all" href={order.paymentUrl} target="_blank" rel="noreferrer">{order.paymentUrl}</a></div>}
          <div className="flex gap-2 pt-2">
            <button onClick={capture} className="px-3 py-1.5 bg-slate-200 rounded">Capture</button>
            <button onClick={checkStatus} className="px-3 py-1.5 bg-slate-200 rounded">Refresh status</button>
          </div>
        </div>
      )}
    </div>
  );
}