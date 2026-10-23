// Owner.test
// ==========
// `UNII_DIR=$(mktemp -d /tmp/unii-t.XXXX) bun test Owner.test.ts`: the
// sign-in pages (Owner.page_confirm): who asks, in Portuguese whatever
// language its unii names it in, a device's warning, the code's field.

import { expect, test } from "bun:test";
import { Owner } from "./Owner.ts";

const html = (r: Response) => r.text();

test("a device's page names it and warns it runs commands and edits files there", async () => {
  const page = await html(Owner.page_confirm("t1", "o dispositivo enzo", ""));
  expect(page).toContain('<html lang="pt-BR">');
  expect(page).toContain('<span class="who">o dispositivo enzo</span> quer usar este servidor.');
  expect(page).toContain("rodar comandos e editar arquivos");
  expect(page).toContain("Código mostrado no dispositivo");
  expect(page).toContain('name="code"');
});

test("a terminal's page, even one that names itself in English, has no device warning", async () => {
  const page = await html(Owner.page_confirm("t2", "the terminal on velho", ""));
  expect(page).toContain('<span class="who">o terminal em velho</span>');
  expect(page).not.toContain("rodar comandos");
  expect(page).toContain("Código mostrado no terminal");
});

test("a wrong code shows as an alert above the field", async () => {
  const page = await html(Owner.page_confirm("t3", "o terminal em x", "O código não confere."));
  expect(page).toMatch(/<p class="err" role="alert">O código não confere\.<\/p>.*name="code"/s);
});
