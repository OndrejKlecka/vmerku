"use client";

import { useState, useTransition } from "react";

import { removeProduct } from "@/app/actions";

export function RemoveProductButton({ productId, name }: { productId: number; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button type="button" className="btn btn-quiet" onClick={() => setConfirming(true)}>
        Přestat hlídat
      </button>
    );
  }

  return (
    <div className="card">
      <p style={{ marginTop: 0 }}>
        Opravdu přestat hlídat <strong>{name}</strong>? Smaže se i historie cen.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => startTransition(() => removeProduct(productId))}
        >
          {pending ? "Mažu…" : "Ano, smazat"}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
          Zrušit
        </button>
      </div>
    </div>
  );
}
