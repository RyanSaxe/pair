import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pageWidthAt,
  readWidth,
  sidebarWidthAt,
} from "../../../src/frame/app/edges.mjs";

test("the page's width is twice the pointer's distance from the window's center, on either side", () => {
  assert.equal(pageWidthAt(1800, 2000), 1600);
  assert.equal(pageWidthAt(200, 2000), 1600);
  assert.equal(pageWidthAt(1800, 2001), 1599);
});

test("the page's width stops at 1160px, and within 24px of the window's edge it takes the whole window", () => {
  assert.equal(pageWidthAt(1000, 2000), 1160);
  assert.equal(pageWidthAt(1200, 2000), 1160);
  assert.equal(pageWidthAt(1975, 2000), 1950);
  assert.equal(pageWidthAt(1976, 2000), 2000);
  assert.equal(pageWidthAt(24, 2000), 2000);
});

test("in a window barely wider than 1160px, a pointer short of the window's edge returns the page to 1160px", () => {
  assert.equal(pageWidthAt(1140, 1170), 1160);
  assert.equal(pageWidthAt(1150, 1170), 1170);
});

test("the sidebar's width is the pointer's distance from the body's left, from 224px to 400px, in whole pixels", () => {
  assert.equal(sidebarWidthAt(470, 170), 300);
  assert.equal(sidebarWidthAt(470.4, 170), 300);
  assert.equal(sidebarWidthAt(200, 170), 224);
  assert.equal(sidebarWidthAt(900, 170), 400);
});

test("a saved width counts only as a whole number in its range", () => {
  assert.equal(readWidth("1500", 1161, Infinity), 1500);
  assert.equal(readWidth("400", 225, 400), 400);
  for (const value of [null, "", "wide", "1500.5", "1160", "NaN"])
    assert.equal(readWidth(value, 1161, Infinity), null, String(value));
  assert.equal(readWidth("401", 225, 400), null);
});
