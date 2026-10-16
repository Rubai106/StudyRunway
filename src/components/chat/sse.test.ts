import { describe, expect, it, vi } from "vitest";
import { createSSEParser, parseSSELine } from "./sse";

describe("parseSSELine", () => {
  it("parses a data line into an event", () => {
    const e = parseSSELine(
      'data: {"type":"assistant_text","text":"Hello"}',
    );
    expect(e).toEqual({ type: "assistant_text", text: "Hello" });
  });

  it("ignores blanks, comments and [DONE]", () => {
    expect(parseSSELine("")).toBeNull();
    expect(parseSSELine("   ")).toBeNull();
    expect(parseSSELine(": ping")).toBeNull();
    expect(parseSSELine("data: [DONE]")).toBeNull();
    expect(parseSSELine("event: status")).toBeNull();
  });
});

describe("createSSEParser", () => {
  it("reassembles events split across chunks", () => {
    const onEvent = vi.fn();
    const parser = createSSEParser(onEvent);
    parser.feed('data: {"type":"assistant_text","text":"Hel');
    parser.feed('lo"}\n\ndata: {"type":"status","phase":"pla');
    parser.feed('nning"}\n');
    parser.flush();
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: "assistant_text",
      text: "Hello",
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: "status",
      phase: "planning",
    });
  });

  it("survives malformed lines without killing the stream", () => {
    const onEvent = vi.fn();
    const parser = createSSEParser(onEvent);
    parser.feed("data: not json at all\n");
    parser.feed('data: {"type":"assistant_text","text":"ok"}\n');
    parser.flush();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: "assistant_text",
      text: "ok",
    });
  });

  it("delivers a trailing partial line on flush", () => {
    const onEvent = vi.fn();
    const parser = createSSEParser(onEvent);
    parser.feed('data: {"type":"error","message":"x","recoverable":true}');
    parser.flush();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      type: "error",
      message: "x",
      recoverable: true,
    });
  });
});
