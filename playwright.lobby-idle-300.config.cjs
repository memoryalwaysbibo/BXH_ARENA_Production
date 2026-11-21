'use strict';
const { defineConfig } = require('@playwright/test');
const established = require('./playwright.e2e.config.cjs');
module.exports = defineConfig({
  ...established,
  testMatch: /lobby-idle-300\.e2e\.cjs$/,
  timeout: 450000,
});
