import React, { useEffect, useState } from 'react';
import { ServiceOrder } from '../../types';
import { dbGetOrderSignature } from '../../db/firebase';

interface OrderSignatureImageProps {
  order: ServiceOrder;
  className?: string;
  alt?: string;
}

// Mostra a assinatura da OS. A imagem fica gravada à parte (coleção "orderSignatures")
// e só é baixada quando este componente aparece na tela.
export default function OrderSignatureImage({ order, className, alt }: OrderSignatureImageProps) {
  const [src, setSrc] = useState<string | null>(order.signature || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (order.signature) {
      setSrc(order.signature);
      setLoading(false);
      return;
    }
    setSrc(null);
    if (!order.hasSignature) return;

    let cancelled = false;
    setLoading(true);
    dbGetOrderSignature(order.id).then((signature) => {
      if (cancelled) return;
      setSrc(signature);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [order.id, order.signature, order.hasSignature]);

  if (!src) {
    return (
      <span className="text-[10px] text-slate-400 italic">
        {loading ? 'Carregando assinatura...' : 'Assinatura indisponível'}
      </span>
    );
  }

  return <img src={src} alt={alt || 'Assinatura digital'} className={className} referrerPolicy="no-referrer" />;
}
