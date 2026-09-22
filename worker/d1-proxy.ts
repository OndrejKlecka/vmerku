/**
 * Most mezi appkou v kontejneru a D1. Drizzle posílá hotové SQL i parametry
 * a čeká řádky jako pole hodnot – přesně to vrací `raw()`.
 *
 * Samostatně, aby šel vyzkoušet proti skutečnému D1 bez kontejneru.
 */
export async function d1Proxy(request: Request, env: { DB: D1Database }): Promise<Response> {
  if (request.method !== "POST") return new Response("Jen POST", { status: 405 });

  const { sql, params, method } = (await request.json()) as {
    sql: string;
    params: unknown[];
    method: "run" | "all" | "values" | "get";
  };

  const statement = env.DB.prepare(sql).bind(...params);
  if (method === "get") {
    const rows = await statement.raw();
    // Když řádek není, musí přijít null. Prázdné pole si drizzle vyloží jako
    // nalezený řádek se samými prázdnými sloupci.
    return Response.json({ rows: rows[0] ?? null });
  }
  if (method === "run") {
    await statement.run();
    return Response.json({ rows: [] });
  }
  return Response.json({ rows: await statement.raw() });
}
