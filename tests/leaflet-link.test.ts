import assert from "node:assert/strict";
import { test } from "node:test";

import { findPdfLink } from "../src/lib/scrapers/leaflet-link";

const TESCO =
  "https://digitalcontent.api.tesco.com/v2/media/dotcom-cz/9ab44141-b4aa-48af-8a66-b68440b1124e/20260923062713427_2026_P30_CZ_HM-CHM.pdf";

test("najde PDF v obyčejném odkazu", () => {
  assert.equal(findPdfLink(`<a href="${TESCO}">Stáhnout</a>`), TESCO);
});

test("najde PDF v JSON uvnitř stránky s escapovanými lomítky", () => {
  const json = JSON.stringify({ pdf: TESCO }).replace(/\//g, "\\/");
  assert.equal(findPdfLink(`<script>${json}</script>`), TESCO);
  assert.equal(
    findPdfLink(`{"u":"${TESCO.replace(/\//g, "\\u002F")}"}`),
    TESCO,
  );
});

test("leták má přednost před jiným PDF", () => {
  const html = `<a href="https://www.itesco.cz/podminky.pdf">x</a><a href="${TESCO}">y</a>`;
  assert.equal(findPdfLink(html), TESCO);
});

test("bez PDF vrátí null", () => {
  assert.equal(findPdfLink("<p>nic</p>"), null);
});

test("s nápovědou vybere hypermarket mezi víc letáky", () => {
  const sm = TESCO.replace("HM-CHM", "SM-CSM");
  const html = `<a href="${sm}">a</a><a href="${TESCO}">b</a>`;
  assert.equal(findPdfLink(html, "HM-CHM"), TESCO);
  assert.equal(findPdfLink(html, "neexistuje"), null);
});

test("Tesco: z dat stránky vezme leták, který platí teď", () => {
  const next = TESCO.replace(
    "20260923062713427_2026_P30",
    "20260930000000000_2026_P31",
  );
  const html =
    `{"Leaflet:705":{"slug":"a","leafletUrl":"${TESCO}","countryId":2,"validFrom":"2026-09-23T06:00:00.000Z","validTo":"2026-09-29T21:59:59.000Z","type":"HM"},` +
    `"Leaflet:706":{"slug":"b","leafletUrl":"${next}","countryId":2,"validFrom":"2026-09-30T06:00:00.000Z","validTo":"2026-10-06T21:59:59.000Z","type":"HM"}}`;
  assert.equal(
    findPdfLink(html, undefined, new Date("2026-09-25T10:00:00Z")),
    TESCO,
  );
  assert.equal(
    findPdfLink(html, undefined, new Date("2026-10-01T10:00:00Z")),
    next,
  );
});
