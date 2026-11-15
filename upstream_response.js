function contentText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .filter(part => {
      if (!part || typeof part !== "object") return true;
      const type = String(part.type || "").toLowerCase();
      return !/^(?:thinking|reasoning)$/.test(type);
    })
    .map(part => typeof part === "string" ? part : String(part?.text || part?.content || ""))
    .join("");
}

function stripThinkingTags(text) {
  // 完整闭合的  块
  text = text.replace(/<(?:thinking|think|reasoning)\b[^>]*>[\s\S]*?<\/(?:thinking|think|reasoning)\s*>/gi, "");
  // 没闭合的开标签：只删标签本身，不砍后面正文
  text = text.replace(/<(?:thinking|think|reasoning)\b[^>]*>/gi, "");
  // 残留的闭合标签
  text = text.replace(/<\/(?:thinking|think|reasoning)\s*>/gi, "");
  return text.trim();
}

function parseSseChatCompletion(text) {
  let streamed = "";
  let completed = "";
  let lastPayload = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^data:\s*(.*)$/i);
    if (!match) continue;
    const raw = match[1].trim();
    if (!raw || raw === "[DONE]") continue;
    let payload;
    try { payload = JSON.parse(raw); } catch { continue; }
    if (payload?.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
    lastPayload = payload;
    const choice = payload?.choices?.[0] || {};
    const delta = contentText(choice.delta?.content);
    const message = contentText(choice.message?.content);
    const legacy = contentText(choice.text);
    if (delta) streamed += delta;
    else if (message || legacy) completed = message || legacy;
  }
  const content = stripThinkingTags(streamed || completed);
  if (!content && !lastPayload) throw new Error("SSE 响应中没有可读取的 data JSON");
  return {
    ...(lastPayload || {}),
    choices: [{ ...(lastPayload?.choices?.[0] || {}), message: { ...(lastPayload?.choices?.[0]?.message || {}), content } }]
  };
}

function parseChatCompletionResponse(text, contentType = "") {
  const raw = String(text || "");
  if (/text\/event-stream/i.test(contentType) || /^\s*(?:event:.*\r?\n)?data:/i.test(raw)) {
    return parseSseChatCompletion(raw);
  }
  const payload = JSON.parse(raw);
  // 非流式响应也过滤一遍
  if (Array.isArray(payload?.choices)) {
    for (const choice of payload.choices) {
      if (choice?.message?.content) {
        choice.message.content = stripThinkingTags(contentText(choice.message.content));
      }
    }
  }
  return payload;
}

module.exports = { parseChatCompletionResponse, parseSseChatCompletion };
