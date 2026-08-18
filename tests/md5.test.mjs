import { expect, test } from "vitest";
import { md5Hex } from "../lib/md5.js";

test("md5Hex matches known vectors", () => {
  expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
  expect(md5Hex("abc")).toBe("900150983cd24fb0d6963f7d28e17f72");
  expect(md5Hex("The quick brown fox jumps over the lazy dog")).toBe("9e107d9d372bb6826bd81d3542a419d6");
});

test("md5Hex handles unicode and surrogate branches", () => {
  expect(md5Hex("中文")).toBe("a7bac2239fcdcb3a067903d8077c4a07");
  expect(md5Hex("é")).toBe("66ddcd97cfdeabb2f6fb8a999b4bc76f");
  expect(md5Hex("😀")).toBe("2a02eac39d716a70ecf37579185927b6");
  expect(md5Hex(String.fromCharCode(0xd800))).toBe("9b759040321a408a5c7768b4511287a6");
  expect(md5Hex(String.fromCharCode(0xdc00))).toBe("9b759040321a408a5c7768b4511287a6");
});
