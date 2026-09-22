"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { seriesColor } from "@/lib/colors";

export type ChartPoint = { date: string; [store: string]: string | number | null };

export function PriceChart({
  data,
  series,
}: {
  data: ChartPoint[];
  series: { name: string; colorIndex: number }[];
}) {
  if (data.length < 2) {
    return (
      <div className="notice">
        Na graf zatím není dost měření. Objeví se, jakmile proběhne pár kontrol.
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 240 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#E7E9ED" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatTick}
            tick={{ fill: "#666C78", fontSize: 12 }}
            stroke="#C9CDD6"
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: "#666C78", fontSize: 12 }}
            stroke="#C9CDD6"
            width={48}
            /* Rozsah podle dat – u cen je rozdíl pár korun to podstatné. */
            domain={["dataMin - 2", "dataMax + 2"]}
            tickFormatter={(v) => `${Math.round(Number(v))}`}
          />
          <Tooltip
            labelFormatter={(label) => formatTick(String(label))}
            formatter={(value, name) => [`${Number(value)} Kč`, String(name)]}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #E3E5EA",
              fontSize: 13,
            }}
          />
          {series.map((s) => (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={seriesColor(s.colorIndex)}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function formatTick(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("cs-CZ", { day: "numeric", month: "numeric" });
}
