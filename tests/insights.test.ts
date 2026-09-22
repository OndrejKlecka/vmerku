import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeInsights, weeklyTrend } from "../src/lib/insights";

const day = (offset: number) => {
  const d = new Date("2026-09-22T08:00:00Z");
  d.setDate(d.getDate() - offset);
  return d;
};

describe("computeInsights", () => {
  const observations = [
    { price: 20, observedAt: day(30) },
    { price: 24, observedAt: day(20) },
    { price: 16, observedAt: day(1) },
  ];

  it("spočítá průměr, minimum a maximum", () => {
    const insights = computeInsights(observations, 16);
    assert.equal(insights.min, 16);
    assert.equal(insights.max, 24);
    assert.equal(insights.average, 20);
  });

  it("pozná nejnižší cenu za období", () => {
    assert.equal(computeInsights(observations, 16).isLowestInRange, true);
    assert.equal(computeInsights(observations, 18).isLowestInRange, false);
  });
});

describe("weeklyTrend", () => {
  it("spočítá pokles proti ceně před týdnem", () => {
    const trend = weeklyTrend(
      [
        { price: 20, observedAt: day(10) },
        { price: 15, observedAt: day(0) },
      ],
      new Date("2026-09-22T08:00:00Z"),
    );
    assert.ok(trend != null && Math.round(trend) === -25, `trend byl ${trend}`);
  });

  it("vrátí null, když není s čím srovnat", () => {
    assert.equal(weeklyTrend([{ price: 20, observedAt: day(0) }]), null);
  });
});
