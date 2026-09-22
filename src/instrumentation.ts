/**
 * Spustí plánovač uvnitř webového procesu, když je SCHEDULER_IN_PROCESS=1.
 *
 * Na hostinzích, kde běží jeden kontejner s jedním diskem (Render, Railway),
 * nejde plánovač oddělit do vlastní služby – SQLite soubor umí připojit jen
 * jeden proces. Tam appka hlídá sama sebe. Na serveru s Dockerem se místo toho
 * použije druhý kontejner z compose.yaml a tahle proměnná se nechá vypnutá.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SCHEDULER_IN_PROCESS !== "1") return;

  const [{ connect }, { startScheduler }] = await Promise.all([
    import("@/db/connect"),
    import("@/lib/scheduler"),
  ]);

  startScheduler(connect(), { checkOnStart: false });
}
