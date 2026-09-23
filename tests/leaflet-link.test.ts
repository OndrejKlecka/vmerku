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
