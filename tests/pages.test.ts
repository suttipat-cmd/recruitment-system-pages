import { test } from "node:test";
import assert from "node:assert/strict";
import { appAddress, configAddress, attachmentsEnabled } from "../web/runtime";
test("GitHub Pages links and auth redirects retain repository path", () => {
  const origin = "https://user.github.io";
  const base = "/Recruitment-System/";
  assert.equal(
    appAddress(origin, base, "#apply"),
    "https://user.github.io/Recruitment-System/#apply",
  );
  assert.equal(
    appAddress(origin, base),
    "https://user.github.io/Recruitment-System/",
  );
  assert.equal(
    configAddress(origin, base, false),
    "https://user.github.io/Recruitment-System/config.json",
  );
  assert.equal(
    configAddress("http://localhost:3000", "/", true),
    "http://localhost:3000/api/config",
  );
  assert.equal(
    appAddress("https://site.vercel.app", "/", "#apply"),
    "https://site.vercel.app/#apply",
  );
});
test("attachments stay disabled until the private bridge is configured", () => {
  assert.equal(attachmentsEnabled, false);
});
