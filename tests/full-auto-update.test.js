"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const updater = read("auto-update.ps1");
const enable = read("Enable auto-update.bat");
const disable = read("Disable auto-update.bat");
const runNow = read("Update now.bat");
const restore = read("Restore previous version.bat");

test("full updater uses exact main commit and successful CI", () => {
  assert.match(updater, /\$Repo\s*=\s*"ngotrongduong\/ovipet"/);
  assert.match(updater, /\$Branch\s*=\s*"main"/);
  assert.match(updater, /\$ExpectedName\s*=\s*"OviPets Hatchery Helper"/);
  assert.match(updater, /\/actions\/workflows\/ci\.yml\/runs\?branch=main/);
  assert.match(updater, /\$_\.head_sha -eq \$sha/);
  assert.match(updater, /\$_\.event -eq "push"/);
  assert.match(updater, /\$_\.conclusion -eq "success"/);
  assert.match(updater, /\/zip\/\$sha/);
  assert.doesNotMatch(updater, /Invoke-Expression|IEX\s|ScriptBlock::Create|Start-Process.*\.exe/i);
});

test("full updater waits for browsers and safely snapshots only runtime files", () => {
  assert.match(updater, /function Browser-Running/);
  for (const name of ["msedge", "chrome", "brave"]) {
    assert.ok(updater.includes('"' + name + '"'), "missing browser gate " + name);
  }
  assert.match(updater, /elseif \(Browser-Running\)/);
  assert.match(updater, /if \(Browser-Running\) \{ throw "Browser reopened during staging/);
  assert.match(updater, /foreach \(\$relative in \$copyList\) \{\s*if \(Browser-Running\)/);
  assert.match(updater, /allowedExt/);
  assert.match(updater, /allowedFiles/);
  assert.match(updater, /allowedDirs/);
  assert.match(updater, /if \(\$relative -eq "manifest\.json"\) \{ return \$false \}/);
  assert.doesNotMatch(updater, /robocopy|\/MIR|Copy-Item.+\.ps1|Copy-Item.+\.bat/i);
  assert.match(updater, /Copy-Item -LiteralPath \(Join-Path \$root "manifest\.json"\)/);
  assert.match(updater, /\$backupDir = Join-Path \$target "\.oweh-full-update-backup"/);
  assert.match(updater, /Restore-Backup \$backupDir/);
  assert.match(updater, /function Assert-Candidate/);
  assert.match(updater, /Assert-Relative/);
  assert.match(updater, /FileShare\]::None/);
});

test("Windows task installer uses separate task name and system tools with CRLF", () => {
  for (const [name, body] of [
    ["Enable auto-update.bat",enable],["Disable auto-update.bat",disable],
    ["Update now.bat",runNow],["Restore previous version.bat",restore]
  ]) {
    assert.ok(body.includes("\r\n"), name + ": missing CRLF");
    assert.ok(!/[^\r]\n/.test(body), name + ": lone LF");
    assert.ok(!/[^\x00-\x7f]/.test(body), name + ": non-ASCII");
  }
  assert.match(enable, /\/SC MINUTE \/MO 30/);
  assert.match(enable, /%SystemRoot%\\System32/);
  assert.match(enable, /if not exist "%FOLDER%manifest\.json"/);
  assert.match(enable, /if not exist "%FOLDER%auto-update\.ps1"/);
  assert.match(enable, /schtasks\.exe/);
  assert.match(enable, /\/TN "%TASK%"/);
  assert.match(disable, /OviPets Full Extension update/);
  assert.match(runNow, /auto-update\.ps1/);
  assert.match(restore, /auto-update\.ps1" -Rollback/);
});

test("updater is external; current extension code remains at stable main version", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.name, "OviPets Hatchery Helper");
  assert.equal(manifest.version, "5.12.0");
  assert.ok(!manifest.content_scripts.some(group => (group.js || []).includes("auto-update.ps1")));
});
