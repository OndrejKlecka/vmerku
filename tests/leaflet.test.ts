import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type Cell,
  itemsFromCells,
  isGarbled,
  itemsFromLines,
  mergeSplitPrices,
  parsePrice,
  parseValidity,
} from "../src/lib/scrapers/leaflet";

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
    const { from, to } = parseValidity(
      "28. 12. – 3. 1.",
      new Date(2026, 11, 20),
    );
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

describe("itemsFromCells", () => {
  const validity = { from: new Date(2026, 8, 23), to: new Date(2026, 8, 29) };

  /** Tři dlaždice vedle sebe, jak je leták sází: název nahoře, ceny pod ním. */
  const grid: Cell[] = [
    { text: "Pivo Holba Šerák 11° 0,5 l", page: 1, x: 30, width: 150, y: 700 },
    { text: "Máslo Madeta 250 g", page: 1, x: 220, width: 150, y: 700 },
    { text: "Káva Tchibo Family 250 g", page: 1, x: 410, width: 150, y: 700 },
    { text: "15,90 Kč", page: 1, x: 30, width: 70, y: 660 },
    { text: "49,90 Kč", page: 1, x: 220, width: 70, y: 660 },
    { text: "74,90 Kč", page: 1, x: 410, width: 70, y: 660 },
    { text: "19,90 Kč", page: 1, x: 30, width: 60, y: 638 },
  ];

  it("nespojí sousední sloupce do jedné položky", () => {
    const items = itemsFromCells(grid, validity);
    assert.equal(items.length, 3);
    assert.deepEqual(items.map((i) => i.rawName).sort(), [
      "Káva Tchibo Family 250 g",
      "Máslo Madeta 250 g",
      "Pivo Holba Šerák 11° 0,5 l",
    ]);
  });

  it("spáruje cenu s názvem ve svém sloupci", () => {
    const items = itemsFromCells(grid, validity);
    const beer = items.find((i) => i.rawName.startsWith("Pivo Holba"));
    assert.equal(beer?.price, 15.9);
    assert.equal(beer?.regularPrice, 19.9);

    const butter = items.find((i) => i.rawName.startsWith("Máslo"));
    assert.equal(butter?.price, 49.9);
    assert.equal(butter?.regularPrice, null);
  });

  it("nepřiřadí cenu k názvu na opačném konci stránky", () => {
    const items = itemsFromCells(
      [
        { text: "Máslo Madeta 250 g", page: 1, x: 30, width: 150, y: 700 },
        { text: "49,90 Kč", page: 1, x: 30, width: 70, y: 200 },
      ],
      validity,
    );
    assert.equal(items.length, 0);
  });
});

describe("mergeSplitPrices", () => {
  it("spojí cenu vysázenou na dvě velikosti písma", () => {
    const merged = mergeSplitPrices([
      { text: "89", page: 1, x: 40, width: 70, y: 300 },
      { text: ",90", page: 1, x: 112, width: 26, y: 312 },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].text, "89,90 Kč");
  });

  it("nespojí čísla, která spolu nesousedí", () => {
    const merged = mergeSplitPrices([
      { text: "89", page: 1, x: 40, width: 70, y: 300 },
      { text: ",90", page: 1, x: 400, width: 26, y: 300 },
    ]);
    assert.equal(merged.length, 2);
  });
});

describe("itemsFromCells – sazba letáku Lidlu", () => {
  const validity = { from: new Date(2026, 8, 21), to: new Date(2026, 8, 23) };

  /**
   * Skutečná sazba z letáku: popis vlevo od ceny u cereálií, vpravo od ceny
   * u krůtích prsou, a haléře menším písmem na jiném účaří.
   */
  const tile: Cell[] = [
    { text: "NESTLÉ Cereálie", page: 1, x: 30, width: 90, y: 520 },
    { text: "Super cena", page: 1, x: 30, width: 80, y: 420 },
    { text: "89", page: 1, x: 32, width: 120, y: 360 },
    { text: ",90", page: 1, x: 156, width: 40, y: 380 },
    { text: "Super cena", page: 1, x: 400, width: 80, y: 420 },
    { text: "199", page: 1, x: 402, width: 160, y: 360 },
    { text: ",90", page: 1, x: 566, width: 40, y: 380 },
    { text: "Krůtí prsa", page: 1, x: 616, width: 70, y: 380 },
  ];

  it("spáruje cenu s popisem vlevo i vpravo od ní", () => {
    const items = itemsFromCells(tile, validity);
    const cereals = items.find((i) => i.rawName.includes("Cereálie"));
    const turkey = items.find((i) => i.rawName.includes("Krůtí"));

    assert.equal(cereals?.price, 89.9);
    assert.equal(turkey?.price, 199.9);
  });
});

it("Tesco dlaždice: cena, běžná cena a bez jednotkových cen a štítků", () => {
  // Výřez skutečné textové vrstvy letáku Tesco (23. 9. 2026, strana 7).
  const cells = [
    ["Běž ná", 22, 268, 15],
    ["cena 62,90", 22, 264, 44],
    ["Ǖ 36 %", 30, 244, 26],
    ["90", 49, 228, 13],
    ["39", 24, 220, 25],
    ["Milka Sušenky", 75, 220, 46],
    ["112–260 g, více druhů", 75, 212, 66],
    ["(100 g = 40,09–23,04 Kč)", 75, 204, 77],
    ["Clubcard", 27, 200, 33],
    ["s Clubcard:", 75, 196, 36],
    ["cena", 35, 192, 17],
    ["(100 g = 31,16–13,42 Kč)", 75, 188, 71],
    ["BÉ¨Á«��¨«ÔÛ÷", 75, 344, 54],
  ].map(([text, x, y, width]) => ({ text, x, y, width, page: 7 }) as Cell);

  const items = itemsFromCells(cells, { from: null, to: null });
  const milka = items.find((i) => i.rawName === "Milka Sušenky");
  assert.ok(milka, JSON.stringify(items));
  assert.equal(milka.price, 39.9);
  assert.equal(milka.regularPrice, 62.9);
  assert.ok(
    !items.some((i) => /Clubcard|více druhů|¨/.test(i.rawName)),
    JSON.stringify(items),
  );
});

it("rozsypaný text z písma bez převodní tabulky se pozná", () => {
  assert.equal(isGarbled("BÉ¨Á«��¨«ÔÛ÷"), true);
  assert.equal(isGarbled("c¨«É��ĉÛÛ«ÁÉ"), true);
  assert.equal(isGarbled("Milka Sušenky"), false);
  assert.equal(isGarbled("Vepřová kýta bez kosti*"), false);
});
