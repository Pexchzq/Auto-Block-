import assert from "node:assert/strict";
import test from "node:test";
import {
  panelComponents,
  panelEmbed,
  toolPickerComponents,
  topUpComponents,
} from "../src/ui.mjs";

test("panel exposes top up, user, and tools actions", () => {
  const row = panelComponents()[0].toJSON();
  assert.deepEqual(
    row.components.map((item) => item.custom_id),
    ["orions:topup", "orions:user", "orions:tools"],
  );
});

test("panel renders live queue counts and animated banner", () => {
  const embed = panelEmbed({ queued: 4, running: 2, retrying: 1 }).toJSON();
  assert.match(embed.image.url, /orions-panel-v1\.gif$/);
  assert.equal(embed.fields.find((field) => field.name === "คิวรอ").value, "📥 4 งาน");
  assert.equal(embed.fields.find((field) => field.name === "กำลังทำ").value, "⚙️ 2 งาน");
});

test("tool picker starts with block id v1", () => {
  const select = toolPickerComponents()[0].toJSON().components[0];
  assert.equal(select.custom_id, "orions:tool-select");
  assert.equal(select.options[0].value, "block-id-v1");
});

test("top up action links to the configured website", () => {
  const buttons = topUpComponents("https://auto-block.vercel.app")[0].toJSON().components;
  assert.equal(buttons[0].custom_id, "orions:topup:voucher");
  assert.equal(buttons[1].url, "https://auto-block.vercel.app");
});
