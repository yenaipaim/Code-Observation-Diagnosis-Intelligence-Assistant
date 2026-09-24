export type FetchLike = typeof fetch;

export const DEFAULT_API_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_API_MODEL = "deepseek-chat";

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export function resolveChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) {
    throw new Error("API Base URL 未配置");
  }
  if (/\/chat\/completions$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

export function extractJson<T>(content: string): T {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error("API response did not contain a JSON object");
  }

  return JSON.parse(content.slice(start, end + 1)) as T;
}

export class ChatCompletionsClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = DEFAULT_API_BASE_URL,
    private readonly model = DEFAULT_API_MODEL,
    private readonly timeoutMs = 30_000
  ) {}

  async completeJson<T>(systemPrompt: string, userPrompt: string): Promise<T> {
    const endpoint = resolveChatCompletionsUrl(this.baseUrl);
    const model = this.model.trim();
    if (!model) {
      throw new Error("API 模型未配置");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.apiKey.trim()}`;
    }

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];
    const baseBody = {
      model,
      temperature: 0.2,
      messages
    };
    const requestJson = async (
      body: Record<string, unknown>
    ): Promise<Response> =>
      this.fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });

    let response = await requestJson({
      ...baseBody,
      response_format: { type: "json_object" }
    });
    if (!response.ok && (response.status === 400 || response.status === 422)) {
      response = await requestJson(baseBody);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Chat API ${response.status} (${endpoint}): ${body.slice(0, 300)}`
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Chat API response did not contain message content");
    }

    return extractJson<T>(content);
  }
}
