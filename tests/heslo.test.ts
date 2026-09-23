/** Rodinné heslo ve Workeru (viz worker/heslo.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LOGIN_PATH, LOGOUT_PATH, passwordGate } from "../worker/heslo";

const env = { APP_PASSWORD: "rodina123" };
const BASE = "https://vmerku.vandays.cz";

function login(heslo: string, dal = "/produkt/3") {
  const body = new URLSearchParams({ heslo, dal });
  return passwordGate(new Request(`${BASE}${LOGIN_PATH}`, { method: "POST", body }), env);
}

async function cookieFromLogin(): Promise<string> {
  const response = await login("rodina123");
  return response!.headers.get("set-cookie")!.split(";")[0];
}

describe("passwordGate", () => {
  it("bez nastaveného hesla nepustí nikoho", async () => {
    const response = await passwordGate(new Request(`${BASE}/`), {});
    assert.equal(response?.status, 503);
  });

  it("nepřihlášeného pošle na přihlášení a zapamatuje si, kam chtěl", async () => {
    const response = await passwordGate(new Request(`${BASE}/nastaveni?x=1`), env);
    assert.equal(response?.status, 303);
    assert.equal(response?.headers.get("location"), `${LOGIN_PATH}?dal=%2Fnastaveni%3Fx%3D1`);
  });

  it("nepřihlášený POST (formulář appky) dostane 401", async () => {
    const response = await passwordGate(new Request(`${BASE}/nastaveni`, { method: "POST" }), env);
    assert.equal(response?.status, 401);
  });

  it("přihlašovací stránka se ukáže", async () => {
    const response = await passwordGate(new Request(`${BASE}${LOGIN_PATH}?dal=/pridat`), env);
    assert.equal(response?.status, 200);
    assert.match(await response!.text(), /name="dal" value="\/pridat"/);
  });

  it("špatné heslo neprojde a cookie nedá", async () => {
    const response = await login("spatne");
    assert.equal(response?.status, 401);
    assert.equal(response?.headers.get("set-cookie"), null);
  });

  it("správné heslo nastaví cookie a vrátí na původní stránku", async () => {
    const response = await login("rodina123");
    assert.equal(response?.status, 303);
    assert.equal(response?.headers.get("location"), "/produkt/3");
    const cookie = response!.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.doesNotMatch(cookie, /rodina123/);
  });

  it("po přihlášení nepřesměruje na cizí web", async () => {
    for (const dal of ["//zly.example", "https://zly.example", "/\\zly.example"]) {
      const response = await login("rodina123", dal);
      assert.equal(response?.headers.get("location"), "/");
    }
  });

  it("s platnou cookie pustí dál", async () => {
    const cookie = await cookieFromLogin();
    const response = await passwordGate(new Request(`${BASE}/`, { headers: { cookie } }), env);
    assert.equal(response, null);
  });

  it("po změně hesla stará cookie neplatí", async () => {
    const cookie = await cookieFromLogin();
    const response = await passwordGate(new Request(`${BASE}/`, { headers: { cookie } }), {
      APP_PASSWORD: "nove-heslo",
    });
    assert.equal(response?.status, 303);
  });

  it("podvržená cookie neprojde", async () => {
    const response = await passwordGate(
      new Request(`${BASE}/`, { headers: { cookie: "vmerku_pristup=abc" } }),
      env,
    );
    assert.equal(response?.status, 303);
  });

  it("odhlášení cookie smaže", async () => {
    const response = await passwordGate(new Request(`${BASE}${LOGOUT_PATH}`), env);
    assert.match(response!.headers.get("set-cookie")!, /Max-Age=0/);
  });
});
