import nodemailer from "nodemailer";

export type MailPayload = { subject: string; text: string; html: string };

/**
 * Odeslání e-mailu. Bez SMTP konfigurace se zpráva jen vypíše do konzole –
 * appka tak jde spustit a vyzkoušet bez účtu u poskytovatele.
 */
export async function sendMail(to: string, mail: MailPayload): Promise<void> {
  const host = process.env.SMTP_HOST;
  if (!host || !to) {
    console.info(`[mail] (neodesláno – chybí SMTP nebo adresát)\n${mail.subject}\n${mail.text}`);
    return;
  }

  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
      : undefined,
  });

  await transport.sendMail({
    from: process.env.SMTP_FROM ?? "Hlídač akcí <hlidac@localhost>",
    to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

export type SaleAlert = {
  productId: number;
  productName: string;
  storeId: number;
  storeName: string;
  /** Klíč akce pro deduplikaci – zapisuje se do NotificationLog po odeslání. */
  saleWindowStart: Date;
  price: number;
  regularPrice: number | null;
  validTo: Date | null;
  isLowestIn6M: boolean;
};

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

function money(value: number): string {
  return `${value.toFixed(2).replace(".", ",").replace(/,00$/, "")} Kč`;
}

function line(alert: SaleAlert): string {
  const parts = [`${alert.productName} — ${alert.storeName}: ${money(alert.price)}`];
  if (alert.regularPrice) parts.push(`(běžně ${money(alert.regularPrice)})`);
  if (alert.isLowestIn6M) parts.push("· nejnižší cena za 6 měsíců");
  if (alert.validTo) {
    parts.push(`· do ${alert.validTo.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" })}`);
  }
  return parts.join(" ");
}

export function buildSaleMail(alerts: SaleAlert[]): MailPayload {
  const subject =
    alerts.length === 1
      ? `V akci: ${alerts[0].productName} (${alerts[0].storeName})`
      : `V akci: ${alerts.length} hlídaných položek`;

  const text = [
    alerts.length === 1 ? "Sledovaná položka je v akci:" : "Sledované položky jsou v akci:",
    "",
    ...alerts.map((a) => `• ${line(a)}`),
    "",
    `Přehled: ${APP_URL}`,
  ].join("\n");

  const rows = alerts
    .map(
      (a) => `<tr>
  <td style="padding:8px 0;border-bottom:1px solid #E3E5EA">
    <a href="${APP_URL}/produkt/${a.productId}" style="color:#171A21;text-decoration:none;font-weight:600">${escapeHtml(a.productName)}</a>
    <div style="color:#666C78;font-size:14px;margin-top:2px">${escapeHtml(a.storeName)}</div>
  </td>
  <td style="padding:8px 0;border-bottom:1px solid #E3E5EA;text-align:right;white-space:nowrap">
    <span style="color:#15803D;font-weight:700">${money(a.price)}</span>
    ${a.regularPrice ? `<div style="color:#9AA0AC;font-size:13px"><s>${money(a.regularPrice)}</s></div>` : ""}
  </td>
</tr>`,
    )
    .join("");

  const html = `<div style="font-family:'IBM Plex Sans',Helvetica,Arial,sans-serif;background:#F3F4F7;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #E3E5EA;border-radius:10px;padding:20px">
    <h1 style="margin:0 0 16px;font-size:18px;color:#171A21">${escapeHtml(subject)}</h1>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <a href="${APP_URL}" style="display:inline-block;margin-top:20px;background:#1F63B8;color:#FFFFFF;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Otevřít přehled</a>
  </div>
</div>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
