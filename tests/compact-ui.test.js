"use strict";

const fs = require("fs");
const path = require("path");

const panel = fs.readFileSync(path.join(__dirname, "..", "ui", "panel.js"), "utf8");
const dashboard = fs.readFileSync(path.join(__dirname, "..", "ui", "dashboard.js"), "utf8");
const uiSource = `${panel}\n${dashboard}`;
const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");

const modules = [...panel.matchAll(/<details class="oweh-module" name="oweh-modules"/g)];
if (modules.length !== 8) throw new Error(`Expected 8 compact modules, found ${modules.length}`);

for (const required of [
  "oweh-active-summary", "oweh-active-jobs", "oweh-header-state", "oweh-collapse",
  "owehEggRun", "owehSweep", "owehBreedCampaign",
  "owehPetIndex", "owehHatchlingRun", "owehWorker"
]) {
  if (!uiSource.includes(required)) throw new Error(`Dashboard requirement missing: ${required}`);
}

const buttonTags = [...panel.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
const panelButtons = buttonTags.filter(tag => /id="oweh-/.test(tag));
const missingTips = panelButtons.filter(tag => !/data-tip="[^"]+"/.test(tag));
if (missingTips.length) throw new Error(`Buttons missing hover help: ${missingTips.join(" | ")}`);

for (const selector of [
  ".oweh-activity-card", ".oweh-active-jobs", ".oweh-module", ".oweh-collapsed",
  "#ovipets-hatchery-helper-tooltip"
]) {
  if (!css.includes(selector)) throw new Error(`Compact UI style missing: ${selector}`);
}

console.log(`compact UI tests passed (${modules.length} modules, ${panelButtons.length} tooltips)`);
