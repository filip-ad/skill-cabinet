#!/usr/bin/env node

process.env.NODE_ENV = "production";
const { start } = await import("../server/index.js");
start();
