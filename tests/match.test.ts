import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractQuantity, normalize, rankCandidates, similarity } from "../src/lib/match";
import { headerSafe, USER_AGENT } from "../src/lib/scrapers/types";

describe("normalize", () => {
  it("odstraní diakritiku a sjednotí jednotky", () => {
    assert.equal(normalize("Pivo Holba Šerák 11° 0,5 l"), "pivo holba serak 11deg 0.5l");
    assert.equal(normalize("MÁSLO  Madeta 250 g"), "maslo madeta 250g");
  });

  it("srovná různé zápisy téhož objemu", () => {
    assert.equal(normalize("0,5 l"), normalize("0.5l"));
  });
});

describe("extractQuantity", () => {
  it("převede gramy na kilogramy a mililitry na litry", () => {
    assert.deepEqual(extractQuantity(normalize("máslo 250 g")), { value: 0.25, unit: "kg" });
    assert.deepEqual(extractQuantity(normalize("pivo 500 ml")), { value: 0.5, unit: "l" });
  });
});

describe("similarity", () => {
  it("spáruje stejný produkt pojmenovaný dvěma způsoby", () => {
    const score = similarity(
      "Pivo Holba Šerák 11° 0,5 l",
      "Holba Šerák světlé výčepní 0,5 l",
    );
    assert.ok(score > 0.55, `skóre bylo ${score}`);
  });

  it("srazí shodu, když nesedí gramáž", () => {
    const same = similarity("Máslo Madeta 250 g", "Madeta Jihočeské máslo 250 g");
    const different = similarity("Máslo Madeta 250 g", "Madeta Jihočeské máslo 1 kg");
    assert.ok(same > different, `${same} nebylo víc než ${different}`);
  });

  it("nespáruje nesouvisející produkty", () => {
    assert.equal(similarity("Máslo Madeta 250 g", "Toaletní papír Zewa 8 ks"), 0);
  });
});

describe("rankCandidates", () => {
  const leaflet = [
    { name: "Pivo Holba Šerák 11° 0,5l" },
    { name: "Holba Premium ležák 12° 0,5 l" },
    { name: "Máslo Madeta 250g" },
    { name: "Toaletní papír Zewa Deluxe 8 ks" },
  ];

  it("dá nejvýš nejbližší variantu, ne jinou značku", () => {
    const ranked = rankCandidates("Pivo Holba jedenáctka 0,5 l", leaflet, (i) => i.name);
    assert.equal(ranked[0].item.name, "Pivo Holba Šerák 11° 0,5l");
  });

  it("přeloží hovorovou stupňovitost a nezamění ji za jinou", () => {
    const ranked = rankCandidates(
      "Pivo Holba jedenáctka 0,5 l",
      [
        { name: "Holba Premium ležák 12° 0,5 l" },
        { name: "Holba Šerák 11 světlé výčepní 0,5 l" },
      ],
      (i) => i.name,
    );
    assert.equal(ranked[0].item.name, "Holba Šerák 11 světlé výčepní 0,5 l");
  });

  it("nevrátí nic, když v nabídce nic podobného není", () => {
    const ranked = rankCandidates("Káva Tchibo Family 250 g", leaflet, (i) => i.name);
    assert.equal(ranked.length, 0);
  });
});

describe("headerSafe", () => {
  it("zbaví User-Agent diakritiky, jinak by fetch odmítl hlavičku", () => {
    const value = headerSafe("osobní hlídač cen");
    assert.equal(value, "osobni hlidac cen");
    assert.ok([...value].every((ch) => ch.charCodeAt(0) < 256));
  });

  it("výchozí User-Agent projde do hlavičky", () => {
    assert.doesNotThrow(() => new Headers({ "user-agent": USER_AGENT }));
  });
});
