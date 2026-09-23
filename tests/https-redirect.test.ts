/** Worker přesměruje nešifrované požadavky na https (viz worker/https.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { httpsRedirect } from "../worker/https";

describe("httpsRedirect", () => {
  it("pošle http na https se stejnou cestou i dotazem", () => {
    const response = httpsRedirect(new Request("http://vmerku.vandays.cz/produkt/3?x=1"));
    assert.equal(response?.status, 301);
    assert.equal(response?.headers.get("location"), "https://vmerku.vandays.cz/produkt/3?x=1");
  });

  it("u formuláře zachová metodu (308)", () => {
    const response = httpsRedirect(new Request("http://vmerku.vandays.cz/nastaveni", { method: "POST" }));
    assert.equal(response?.status, 308);
  });

  it("localhost nechá (wrangler dev)", () => {
    assert.equal(httpsRedirect(new Request("http://localhost:8787/")), null);
  });

  it("https nechá projít", () => {
    assert.equal(httpsRedirect(new Request("https://vmerku.vandays.cz/")), null);
  });
});
