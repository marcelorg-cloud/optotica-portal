import Link from 'next/link';

type OrderTab = { id: string; orderNumber: number; status: string };

const STATUS_LABEL: Record<string, string> = { in_progress: 'em andamento', completed: 'concluído' };

export function OrderTabs({ orders, activeOrderId }: { orders: OrderTab[]; activeOrderId: string }) {
  if (orders.length < 2) return null;
  return (
    <div className="orders">
      {orders.map((order) => (
        <Link
          key={order.id}
          href={`/cliente/pedido/${order.id}`}
          className={`order-tab${order.id === activeOrderId ? ' active' : ''}`}
        >
          Pedido #{order.orderNumber}
          <small>{STATUS_LABEL[order.status] || order.status}</small>
        </Link>
      ))}
    </div>
  );
}
