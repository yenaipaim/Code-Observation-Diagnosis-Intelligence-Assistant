import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatCompletionsClient,
  extractJson,
  resolveChatCompletionsUrl
} from "../chatClient";

test("chat client defaults to DeepSeek chat and sends bearer auth", async () => {
  let authorization = "";
  let requestUrl = "";
  let requestBody = "";
  const client = new ChatCompletionsClient(
    "secret",
    async (url, init) => {
      requestUrl = String(url);
      authorization = String(new Headers(init?.headers).get("authorization"));
      requestBody = String(init?.body);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" } }]
        }),
        { status: 200 }
      );
    }
  );

  await client.completeJson("system", "user");
  assert.equal(authorization, "Bearer secret");
  assert.equal(requestUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(JSON.parse(requestBody).model, "deepseek-chat");
});

test("chat client accepts a custom base URL and model", async () => {
  let requestUrl = "";
  let requestBody = "";
  const client = new ChatCompletionsClient(
    "custom-secret",
    async (url, init) => {
      requestUrl = String(url);
      requestBody = String(init?.body);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" } }]
        }),
        { status: 200 }
      );
    },
    "https://example.test/v1/",
    "custom-chat-model"
  );

  await client.completeJson("system", "user");
  assert.equal(requestUrl, "https://example.test/v1/chat/completions");
  assert.equal(JSON.parse(requestBody).model, "custom-chat-model");
});

test("chat completions URL does not duplicate an explicit endpoint", () => {
  assert.equal(
    resolveChatCompletionsUrl("https://example.test/v1/chat/completions"),
    "https://example.test/v1/chat/completions"
  );
});

test("chat client retries without JSON mode when a provider rejects it", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const client = new ChatCompletionsClient(
    "secret",
    async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) {
        return new Response("response_format is unsupported", {
          status: 400
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "{}" } }]
        }),
        { status: 200 }
      );
    }
  );

  await client.completeJson("system", "user");
  assert.equal(bodies.length, 2);
  assert.ok(bodies[0]?.response_format);
  assert.equal(bodies[1]?.response_format, undefined);
});

test("extractJson accepts a fenced JSON response", () => {
  assert.deepEqual(
    extractJson<{ judgment: string }>(
      "```json\n{\"judgment\":\"correct\"}\n```"
    ),
    { judgment: "correct" }
  );
});

test("chat client reports an invalid API response", async () => {
  const client = new ChatCompletionsClient(
    "secret",
    async () => new Response("unauthorized", { status: 401 })
  );

  await assert.rejects(
    () => client.completeJson("system", "user"),
    /Chat API 401/
  );
});
