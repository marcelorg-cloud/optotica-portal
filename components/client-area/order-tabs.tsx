import Link from 'next/link';
import { orderStatusLabel } from '@/lib/order-status';

type OrderTab = { id: string; code: string; status: string };


export function OrderTabs({ orders, activeOrderId }: { orders: OrderTab[]; activeOrderId: string }) {
  if (orders.length < 2) return null;
  return (
    <div className="orders">
      {orders.map((order) => (
        <Link
          key={order.id}
          href={`/cliente/pedido/${order.id}`}
          className={`order-tab${order.id === activeOrderId ? ' active' : ''}`}
          aria-current={order.id === activeOrderId ? 'page' : undefined}
        >
          Pedido {order.code}
          <small>{orderStatusLabel(order.status)}</small>
        </Link>
      ))}
    </div>
  );
}
