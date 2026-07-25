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

test("panel renders queue list, animated banner, and brand icon", () => {
  const entries = [
    { position: 1, name: "draftok", percent: 45, status: "running" },
    { position: 2, name: "kae0805", percent: 0, status: "queued" },
  ];
  const embed = panelEmbed({ entries }, "https://cdn.discordapp.com/avatars/1/abc.png").toJSON();
  assert.match(embed.image.url, /orions-panel-v2\.gif$/);
  assert.equal(embed.thumbnail.url, "https://cdn.discordapp.com/avatars/1/abc.png");
  assert.equal(embed.author.icon_url, "https://cdn.discordapp.com/avatars/1/abc.png");
  const queueField = embed.fields.find((field) => field.name === "คิวงาน");
  assert.match(queueField.value, /#1.*draftok.*45%/s);
  assert.match(queueField.value, /#2.*kae0805.*0%/s);
});

test("panel shows an empty state when no jobs are queued", () => {
  const embed = panelEmbed({ entries: [] }).toJSON();
  const queueField = embed.fields.find((field) => field.name === "คิวงาน");
  assert.equal(queueField.value, "ไม่มีงานในคิวตอนนี้");
});

test("tool picker starts with block id v1", () => {
  const select = toolPickerComponents()[0].toJSON().components[0];
  assert.equal(select.custom_id, "orions:tool-select");
  assert.equal(select.options[0].value, "block-id-v1");
});

test("top up action only opens the voucher form", () => {
  const buttons = topUpComponents()[0].toJSON().components;
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].custom_id, "orions:topup:voucher");
});
