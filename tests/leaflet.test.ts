import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { itemsFromLines, parsePrice, parseValidity } from "../src/lib/scrapers/leaflet";

describe("parsePrice", () => {
  it("přečte české zápisy cen", () => {
    assert.equal(parsePrice("24,90 Kč"), 24.9);
    assert.equal(parsePrice("19,-"), 19);
    assert.equal(parsePrice("1 299 Kč"), 1299);
  });
});

describe("parseValidity", () => {
  it("najde rozsah platnosti akce", () => {
    const { from, to } = parseValidity("Platí od 3. 9. do 9. 9. 2026");
    assert.equal(from?.getDate(), 3);
    assert.equal(to?.getMonth(), 8);
    assert.equal(to?.getFullYear(), 2026);
  });

  it("posune konec do dalšího roku přes přelom", () => {
    const { from, to } = parseValidity("28. 12. – 3. 1.", new Date(2026, 11, 20));
    assert.ok(from && to && to > from);
  });
});

describe("itemsFromLines", () => {
  const validity = { from: new Date(2026, 8, 3), to: new Date(2026, 8, 9) };

  it("spáruje cenu s názvem na témže řádku", () => {
    const items = itemsFromLines(
      [{ text: "Pivo Holba Šerák 11° 0,5 l 15,90 Kč", page: 4 }],
      validity,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].price, 15.9);
    assert.equal(items[0].isSale, true);
    assert.equal(items[0].sourceRef, "strana 4");
  });

  it("vezme název z řádku nad cenou", () => {
    const items = itemsFromLines(
      [
        { text: "Máslo Madeta 250 g", page: 2 },
        { text: "49,90 Kč", page: 2 },
      ],
      validity,
    );
    assert.equal(items[0].rawName, "Máslo Madeta 250 g");
    assert.equal(items[0].price, 49.9);
  });

  it("z dvojice cen udělá akční a běžnou", () => {
    const items = itemsFromLines(
      [{ text: "Káva Tchibo Family 250 g 69,90 Kč 89,90 Kč", page: 1 }],
      validity,
    );
    assert.equal(items[0].price, 69.9);
    assert.equal(items[0].regularPrice, 89.9);
  });

  it("u opakovaného názvu nechá nejnižší cenu", () => {
    const items = itemsFromLines(
      [
        { text: "Máslo Madeta 250 g 59,90 Kč", page: 1 },
        { text: "Máslo Madeta 250 g 49,90 Kč", page: 6 },
      ],
      validity,
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].price, 49.9);
  });
});
