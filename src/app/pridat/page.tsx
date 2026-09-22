import { AddProductForm } from "@/components/add-product-form";
import { getActiveStores } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default function AddProductPage() {
  const stores = getActiveStores().map((s) => ({ id: s.id, name: s.name }));

  return (
    <>
      <div className="page-head">
        <h1>Přidat produkt</h1>
      </div>

      {stores.length === 0 ? (
        <div className="empty">
          Nejdřív si v <a href="/nastaveni">Nastavení</a> přidej aspoň jeden obchod.
        </div>
      ) : (
        <AddProductForm stores={stores} />
      )}
    </>
  );
}
