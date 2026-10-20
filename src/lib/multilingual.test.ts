import { describe, expect, it } from "vitest";
import {
  getExamples,
  isLanguageCode,
  responseLanguageInstruction,
  SUPPORTED_LANGUAGES,
  translate,
} from "./multilingual";

describe("multilingual assistant support", () => {
  it("exposes the supported language choices", () => {
    expect(SUPPORTED_LANGUAGES.map(({ code }) => code)).toEqual([
      "en", "bn", "zh", "hi", "es",
    ]);
  });

  it("validates stored language preferences and falls back safely", () => {
    expect(isLanguageCode("bn")).toBe(true);
    expect(isLanguageCode("zh")).toBe(true);
    expect(isLanguageCode(null)).toBe(false);
    expect(isLanguageCode("fr")).toBe(false);
    expect(translate("en", "introTitle")).toBe("Know you can afford the whole journey");
  });

  it("provides localized welcome copy and examples", () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      expect(translate(code, "introTitle").length).toBeGreaterThan(8);
      expect(translate(code, "composerPlaceholder").length).toBeGreaterThan(8);
      expect(getExamples(code)).toHaveLength(4);
    }
    expect(translate("bn", "overview")).toBe("সারসংক্ষেপ");
    expect(translate("zh", "chat")).toBe("聊天");
    expect(translate("hi", "send")).toBe("भेजें");
    expect(translate("es", "retry")).toBe("Reintentar");
  });

  it("tells the assistant which language to use without altering financial values", () => {
    expect(responseLanguageInstruction("bn")).toContain("Bengali");
    expect(responseLanguageInstruction("zh")).toContain("Simplified Chinese");
    expect(responseLanguageInstruction("hi")).toContain("Hindi");
    expect(responseLanguageInstruction("es")).toContain("Spanish");
    expect(responseLanguageInstruction("en")).toContain("English");
    expect(responseLanguageInstruction("es")).toContain("do not change calculations");
  });
});
